geotab.addin.adBlueReport = (api, state) => {
    const DIAGNOSTIC_ADBLUE_ID = "DiagnosticDieselExhaustFluidId";
    const DIAGNOSTIC_ODOMETER_ID = "DiagnosticOdometerAdjustmentId";

    let allDevices = [];
    let allStatusData = [];
    let allOdometerData = [];
    let calculatedResults = []; 
    let myChart = null;

    return {
        initialize(api, state, callback) {
            const today = new Date();
            const lastMonth = new Date();
            lastMonth.setDate(today.getDate() - 30);

            document.getElementById("dateTo").value = today.toISOString().slice(0, 16);
            document.getElementById("dateFrom").value = lastMonth.toISOString().slice(0, 16);

            document.getElementById("refreshBtn").addEventListener("click", () => this.updateReport(api));
            document.getElementById("exportBtn").addEventListener("click", () => this.downloadDetailedCSV());
            document.getElementById("searchInput").addEventListener("input", (e) => this.filterAndRender(e.target.value.toLowerCase()));

            this.updateReport(api);
            callback();
        },

        async updateReport(api) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = '<div class="loading-shimmer">Analizando saltos de nivel para estimar capacidad del tanque...</div>';

            const fromDate = document.getElementById("dateFrom").value;
            const toDate = document.getElementById("dateTo").value;

            try {
                const results = await api.multiCall([
                    ["Get", { typeName: "Device" }],
                    ["Get", { 
                        typeName: "StatusData", 
                        search: { 
                            diagnosticSearch: { id: DIAGNOSTIC_ADBLUE_ID },
                            fromDate: fromDate,
                            toDate: toDate
                        } 
                    }],
                    ["Get", { 
                        typeName: "StatusData", 
                        search: { 
                            diagnosticSearch: { id: DIAGNOSTIC_ODOMETER_ID },
                            fromDate: fromDate,
                            toDate: toDate
                        } 
                    }]
                ]);

                allDevices = results[0];
                allStatusData = results[1];
                allOdometerData = results[2];
                
                this.processData();
                this.renderCards(allDevices);
                this.updateChart();
            } catch (error) {
                container.innerHTML = `<p style="color:red">Error API: ${error.message}</p>`;
                console.error(error);
            }
        },

        processData() {
            const fromLimit = new Date(document.getElementById("dateFrom").value);
            const toLimit = new Date(document.getElementById("dateTo").value);

            calculatedResults = allDevices.map(device => {
                // --- 1. PREPARAR DATOS ---
                const adBlueData = allStatusData
                    .filter(d => d.device.id === device.id)
                    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

                const odoData = allOdometerData
                    .filter(d => d.device.id === device.id)
                    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

                // --- 2. PROCESAR REPOSTAJES MANUALES ---
                let manualRefills = [];
                let totalManualLiters = 0;

                if (device.comment) {
                    const regexGlobal = /\[(\d{1,2})\/(\d{1,2})[^->]*->\s*(\d+)\s*L\]/g;
                    let match;
                    while ((match = regexGlobal.exec(device.comment)) !== null) {
                        const dia = parseInt(match[1]);
                        const mes = parseInt(match[2]) - 1;
                        const litros = parseInt(match[3]);
                        
                        const fechaRegistro = new Date(toLimit.getFullYear(), mes, dia);
                        if (fechaRegistro > toLimit) fechaRegistro.setFullYear(fechaRegistro.getFullYear() - 1);

                        // Ajustamos hora a mediodía para buscar mejor en el rango si no hay hora exacta
                        fechaRegistro.setHours(12, 0, 0);

                        if (fechaRegistro >= fromLimit && fechaRegistro <= toLimit) {
                            manualRefills.push({ date: fechaRegistro, liters: litros });
                            totalManualLiters += litros;
                        }
                    }
                }

                // --- 3. ALGORITMO DE ESTIMACIÓN DE CAPACIDAD DEL TANQUE ---
                let estimatedTankCapacity = null;
                
                // Intentamos calcular la capacidad basándonos en los repostajes encontrados
                // Lógica: Si repostó 20L y el sensor subió un 20%, el tanque es de 100L.
                if (manualRefills.length > 0 && adBlueData.length > 0) {
                    let capacitySamples = [];

                    manualRefills.forEach(refill => {
                        // Buscamos nivel 1 hora antes y 1 hora después del repostaje (aprox)
                        const timeWindow = 3600000 * 4; // 4 horas de margen para encontrar datos
                        const aroundData = adBlueData.filter(d => Math.abs(new Date(d.dateTime) - refill.date) < timeWindow);
                        
                        if (aroundData.length > 1) {
                            // Encontramos el mínimo antes del repostaje y el máximo después
                            const preRefillLevels = aroundData.filter(d => new Date(d.dateTime) <= refill.date).map(d => d.data);
                            const postRefillLevels = aroundData.filter(d => new Date(d.dateTime) > refill.date).map(d => d.data);

                            if (preRefillLevels.length && postRefillLevels.length) {
                                const minPre = Math.min(...preRefillLevels);
                                const maxPost = Math.max(...postRefillLevels);
                                const percentJump = maxPost - minPre;

                                // Solo consideramos válido si el salto es significativo (>5%) para evitar ruido
                                if (percentJump > 5) {
                                    const calcCap = refill.liters / (percentJump / 100);
                                    capacitySamples.push(calcCap);
                                }
                            }
                        }
                    });

                    // Si tenemos muestras válidas, hacemos la media
                    if (capacitySamples.length > 0) {
                        const sum = capacitySamples.reduce((a, b) => a + b, 0);
                        estimatedTankCapacity = Math.round(sum / capacitySamples.length);
                    }
                }

                // --- 4. CÁLCULO DE CONSUMO REAL (BALANCE DE MASAS) ---
                let realConsumedLiters = 0;
                let startLevelPct = adBlueData.length ? adBlueData[0].data : 0;
                let endLevelPct = adBlueData.length ? adBlueData[adBlueData.length - 1].data : 0;
                
                let isRealCalculation = false;

                if (estimatedTankCapacity !== null && adBlueData.length > 0) {
                    // Formula Maestra: (Litros Inicio + Litros Repostados) - Litros Final = Litros Consumidos
                    const startLiters = (startLevelPct / 100) * estimatedTankCapacity;
                    const endLiters = (endLevelPct / 100) * estimatedTankCapacity;
                    
                    realConsumedLiters = (startLiters + totalManualLiters) - endLiters;
                    
                    // Protección contra negativos (si el sensor falla o se repostó fuera de registro)
                    if (realConsumedLiters < 0) realConsumedLiters = 0; 
                    isRealCalculation = true;
                } else {
                    // Fallback: Si no sabemos la capacidad, usamos solo lo repostado (método antiguo)
                    // O estimamos una capacidad estándar de 80L si no hay datos
                    realConsumedLiters = totalManualLiters; 
                }

                // --- 5. DISTANCIA Y RATIO ---
                let distanceKm = 0;
                if (odoData.length > 1) {
                    distanceKm = (odoData[odoData.length - 1].data - odoData[0].data) / 1000;
                }

                let avgConsumption = 0;
                if (distanceKm > 10 && realConsumedLiters > 0) {
                    avgConsumption = (realConsumedLiters / distanceKm) * 100;
                }

                return {
                    id: device.id,
                    name: device.name,
                    plate: device.licensePlate || "N/A",
                    currentLevel: Math.round(endLevelPct),
                    startLevel: Math.round(startLevelPct),
                    
                    // Datos calculados
                    tankCapacity: estimatedTankCapacity, // Nuevo dato
                    isRealCalculation: isRealCalculation, // Booleano para saber si es preciso
                    
                    realConsumedLiters: Math.round(realConsumedLiters * 10) / 10,
                    totalManualLiters: totalManualLiters,
                    numRefills: manualRefills.length,
                    
                    distanceTraveled: Math.round(distanceKm),
                    avgConsumption100km: Math.round(avgConsumption * 100) / 100
                };
            });
        },

        updateChart() {
            const ctx = document.getElementById('comparisonChart').getContext('2d');
            if (myChart) myChart.destroy();

            // Filtramos vehículos con datos relevantes
            const chartData = calculatedResults.filter(r => r.avgConsumption100km > 0).slice(0, 15);

            myChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: chartData.map(r => r.name),
                    datasets: [
                        {
                            label: 'Consumo Real (L/100km)',
                            data: chartData.map(r => r.avgConsumption100km),
                            backgroundColor: chartData.map(r => r.isRealCalculation ? 'rgba(52, 152, 219, 0.7)' : 'rgba(149, 165, 166, 0.5)'), // Azul si es real, Gris si es estimado
                            borderColor: 'rgba(41, 128, 185, 1)',
                            borderWidth: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        tooltip: {
                            callbacks: {
                                afterLabel: function(context) {
                                    const idx = context.dataIndex;
                                    const item = chartData[idx];
                                    return item.isRealCalculation ? `Capacidad Tanque Est: ${item.tankCapacity}L` : "Capacidad desconocida (Cálculo simple)";
                                }
                            }
                        }
                    }
                }
            });
        },

        renderCards(devicesToRender) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = "";
            let criticals = 0;

            devicesToRender.forEach(dev => {
                const res = calculatedResults.find(r => r.id === dev.id);
                if (!res) return;

                if (res.currentLevel !== null && res.currentLevel < 10) criticals++;

                let status = res.currentLevel !== null ? (res.currentLevel < 10 ? "critical" : (res.currentLevel < 20 ? "warning" : "ok")) : "no-data";

                // Etiqueta de precisión
                let precisionTag = "";
                let tankInfo = "";
                
                if (res.isRealCalculation) {
                    precisionTag = `<span style="font-size:0.7em; background:#d4edda; color:#155724; padding:2px 5px; border-radius:3px; margin-left:5px;">✓ Preciso</span>`;
                    tankInfo = `<small style="color:#666">Tanque est: <b>${res.tankCapacity} L</b></small>`;
                } else {
                    precisionTag = `<span style="font-size:0.7em; background:#fff3cd; color:#856404; padding:2px 5px; border-radius:3px; margin-left:5px;">⚠ Aprox</span>`;
                    tankInfo = `<small style="color:#999">Tanque desc.</small>`;
                }

                const card = document.createElement("div");
                card.className = `vehicle-card ${status}`;
                
                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:start;">
                        <div>
                            <strong>${res.name}</strong>
                            <p style="font-size:0.8em; color:#666; margin:2px 0;">${res.plate}</p>
                            ${tankInfo}
                        </div>
                         <div style="text-align:right;">
                            <div style="font-size:1.6em; color:${res.isRealCalculation ? '#2980b9' : '#7f8c8d'}; font-weight:bold">
                                ${res.avgConsumption100km}
                            </div>
                            <small style="color:#666; display:block; margin-top:-5px">L/100km</small>
                            ${precisionTag}
                        </div>
                    </div>
                    
                    <div class="manual-refill-box" style="margin-top:10px; padding: 10px; background:#f8f9fa; border-radius:5px; border:1px solid #eee;">
                        <div style="display:flex; justify-content:space-between; font-size:0.85em; margin-bottom:5px;">
                            <span>Nivel Inicial: <b>${res.startLevel}%</b></span>
                            <span>Nivel Final: <b>${res.currentLevel}%</b></span>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #ddd; padding-top:5px;">
                            <div>
                                <span style="font-size:0.7em; color:#666; display:block">Repostado:</span>
                                <b style="color:#27ae60">${res.totalManualLiters} L</b>
                            </div>
                            <div style="text-align:right">
                                <span style="font-size:0.7em; color:#666; display:block">Real Consumido:</span>
                                <b style="color:#c0392b">${res.realConsumedLiters} L</b>
                            </div>
                        </div>
                    </div>

                    <div style="text-align:center; margin-top:5px; font-size:0.8em; color:#666;">
                        Distancia: <b>${res.distanceTraveled} km</b>
                    </div>
                `;
                container.appendChild(card);
            });
            document.getElementById("count-critical").innerText = criticals;
        },

        downloadDetailedCSV() {
            let csv = "data:text/csv;charset=utf-8,Vehiculo,Matricula,Capacidad Tanque Est (L),Nivel Inicial %,Nivel Final %,Litros Repostados,Litros Consumidos (Real),Distancia (km),Consumo Medio (L/100km),Metodo Calculo\n";
            calculatedResults.forEach(r => {
                csv += `"${r.name}","${r.plate}","${r.tankCapacity || 'Desc'}","${r.startLevel}","${r.currentLevel}","${r.totalManualLiters}","${r.realConsumedLiters}","${r.distanceTraveled}","${r.avgConsumption100km.toString().replace('.',',')}","${r.isRealCalculation ? 'Preciso (Balance Masas)' : 'Simple (Solo Repostaje)'}"\n`;
            });
            const link = document.createElement("a");
            link.setAttribute("href", encodeURI(csv));
            link.setAttribute("download", `Analisis_AdBlue_Real_${new Date().toISOString().slice(0,10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        },
        
        getBarColor(lvl) { return lvl < 10 ? "#e74c3c" : (lvl < 20 ? "#f39c12" : "#27ae60"); },
        filterAndRender(term) { 
            const filtered = allDevices.filter(d => d.name.toLowerCase().includes(term) || (d.licensePlate || "").toLowerCase().includes(term));
            this.renderCards(filtered);
        }
    };
};
