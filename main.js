geotab.addin.adBlueReport = (api, state) => {
    const DIAGNOSTIC_ADBLUE_ID = "DiagnosticDieselExhaustFluidId";
    const DIAGNOSTIC_ODOMETER_ID = "DiagnosticOdometerAdjustmentId"; // ID del Odómetro

    let allDevices = [];
    let allStatusData = [];
    let allOdometerData = []; // Nueva variable para guardar odómetros
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
            document.getElementById("exportBtn").addEventListener("click", () => this.downloadRefillLogCSV()); // Cambiamos la función del botón
            document.getElementById("searchInput").addEventListener("input", (e) => this.filterAndRender(e.target.value.toLowerCase()));

            this.updateReport(api);
            callback();
        },

        async updateReport(api) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = '<div class="loading-shimmer">Obteniendo niveles, lecturas de odómetro y repostajes...</div>';

            const fromDate = document.getElementById("dateFrom").value;
            const toDate = document.getElementById("dateTo").value;

            try {
                // Ahora hacemos 3 llamadas: Vehículos, AdBlue y Odómetro
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
                allStatusData = results[1]; // Datos AdBlue
                allOdometerData = results[2]; // Datos Odómetro (en metros)
                
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
                // 1. Datos Sensor AdBlue
                const adBlueData = allStatusData
                    .filter(d => d.device.id === device.id)
                    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

                // 2. Datos Odómetro del vehículo
                const odoData = allOdometerData
                    .filter(d => d.device.id === device.id)
                    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

                let totalSensorConsumed = 0;
                let lastLevel = null;
                adBlueData.forEach(p => {
                    if (lastLevel !== null) {
                        const diff = lastLevel - p.data;
                        if (diff > 0) totalSensorConsumed += diff;
                    }
                    lastLevel = p.data;
                });

                // 3. Procesar Repostajes Manuales y buscar Odómetro
                let sumaLitrosPeriodo = 0;
                let refillDetails = []; // Aquí guardaremos cada repostaje individual con su KM

                if (device.comment) {
                    const regexGlobal = /\[(\d{1,2})\/(\d{1,2})[^->]*->\s*(\d+)\s*L\]/g;
                    let match;

                    while ((match = regexGlobal.exec(device.comment)) !== null) {
                        const dia = parseInt(match[1]);
                        const mes = parseInt(match[2]) - 1;
                        const litros = parseInt(match[3]);
                        
                        // Determinar fecha del repostaje
                        const fechaRegistro = new Date(toLimit.getFullYear(), mes, dia);
                        if (fechaRegistro > toLimit) fechaRegistro.setFullYear(fechaRegistro.getFullYear() - 1);

                        if (fechaRegistro >= fromLimit && fechaRegistro <= toLimit) {
                            sumaLitrosPeriodo += litros;

                            // --- BÚSQUEDA DEL ODÓMETRO ---
                            // Buscamos el registro de odómetro más cercano a la fecha del repostaje
                            let odometerAtRefill = "N/A";
                            if (odoData.length > 0) {
                                // Encontramos el registro con la menor diferencia de tiempo
                                const closest = odoData.reduce((prev, curr) => {
                                    return (Math.abs(new Date(curr.dateTime) - fechaRegistro) < Math.abs(new Date(prev.dateTime) - fechaRegistro) ? curr : prev);
                                });
                                // Convertimos de metros a KM
                                odometerAtRefill = Math.round(closest.data / 1000); 
                            }

                            // Guardamos el detalle para el CSV
                            refillDetails.push({
                                date: fechaRegistro.toLocaleString(),
                                liters: litros,
                                odometer: odometerAtRefill
                            });
                        }
                    }
                }

                return {
                    id: device.id,
                    name: device.name,
                    plate: device.licensePlate || "N/A",
                    currentLevel: adBlueData.length ? Math.round(adBlueData[adBlueData.length - 1].data) : null,
                    consumed: Math.round(totalSensorConsumed * 10) / 10,
                    totalManualLiters: sumaLitrosPeriodo,
                    numManualRecords: refillDetails.length,
                    refillList: refillDetails // Lista completa para exportar
                };
            });
        },

        updateChart() {
            const ctx = document.getElementById('comparisonChart').getContext('2d');
            if (myChart) myChart.destroy();

            const chartData = calculatedResults.filter(r => r.consumed > 0 || r.totalManualLiters > 0).slice(0, 15);

            myChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: chartData.map(r => r.name),
                    datasets: [
                        {
                            label: 'Consumo Sensor (%)',
                            data: chartData.map(r => r.consumed),
                            backgroundColor: 'rgba(36, 64, 178, 0.6)',
                            yAxisID: 'y'
                        },
                        {
                            label: 'Litros Manuales (L)',
                            data: chartData.map(r => r.totalManualLiters),
                            backgroundColor: 'rgba(39, 174, 96, 0.6)',
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { type: 'linear', position: 'left' },
                        y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false } }
                    }
                }
            });
        },

        renderCards(devicesToRender) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = "";
            let criticals = 0;
            let grandTotalManual = 0;

            devicesToRender.forEach(dev => {
                const res = calculatedResults.find(r => r.id === dev.id);
                if (!res) return;

                if (res.currentLevel !== null && res.currentLevel < 10) criticals++;
                grandTotalManual += res.totalManualLiters;

                let status = res.currentLevel !== null ? (res.currentLevel < 10 ? "critical" : (res.currentLevel < 20 ? "warning" : "ok")) : "no-data";

                // Obtenemos el último odómetro registrado si existe
                const lastOdo = res.refillList.length > 0 ? res.refillList[res.refillList.length - 1].odometer : "--";

                const card = document.createElement("div");
                card.className = `vehicle-card ${status}`;
                card.innerHTML = `
                    <strong>${res.name}</strong>
                    <p style="font-size:0.8em; color:#666; margin:4px 0;">${res.plate}</p>
                    
                    <div class="manual-refill-box" style="border-left: 4px solid ${res.totalManualLiters > 0 ? '#27ae60' : '#ccc'}; background: #f9f9f9; padding: 8px; margin: 10px 0; border-radius: 4px;">
                        <div style="display:flex; justify-content:space-between; align-items:end;">
                            <div>
                                <span style="font-size: 1.2em; font-weight:bold; color: #2e7d32;">${res.totalManualLiters} L</span>
                                <small style="display:block; color:#666; font-size:0.75em;">en ${res.numManualRecords} cargas</small>
                            </div>
                            <div style="text-align:right">
                                <small style="color:#666; font-size:0.7em;">Último Km reg:</small>
                                <div style="font-weight:bold; color:#333;">${lastOdo !== "N/A" ? lastOdo + ' km' : '--'}</div>
                            </div>
                        </div>
                    </div>

                    <div class="consumption-box" style="background:#f0f7ff; padding:8px; border-radius:4px; border: 1px dashed #2440b2;">
                        <small>Sensor: ${res.consumed}%</small>
                    </div>
                `;
                container.appendChild(card);
            });

            document.getElementById("count-critical").innerText = criticals;
            document.getElementById("total-manual-liters").innerText = grandTotalManual + " L";
        },

        // --- NUEVA FUNCIÓN DE EXPORTACIÓN DETALLADA ---
        downloadRefillLogCSV() {
            // Cabecera optimizada para cálculo de rendimiento
            let csv = "data:text/csv;charset=utf-8,Vehiculo,Matricula,Fecha Repostaje,Litros Repostados (L),Odometro (Km)\n";
            
            calculatedResults.forEach(veh => {
                // Si el vehículo tiene repostajes, creamos una fila por cada uno
                if (veh.refillList && veh.refillList.length > 0) {
                    veh.refillList.forEach(refill => {
                        csv += `"${veh.name}","${veh.plate}","${refill.date}","${refill.liters}","${refill.odometer}"\n`;
                    });
                } 
            });

            const link = document.createElement("a");
            link.setAttribute("href", encodeURI(csv));
            link.setAttribute("download", `Bitacora_Repostajes_AdBlue_${new Date().toISOString().slice(0,10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        },
        
        getBarColor(lvl) { /* ... mismo código de antes ... */ return lvl < 10 ? "#e74c3c" : (lvl < 20 ? "#f39c12" : "#27ae60"); },
        filterAndRender(term) { /* ... mismo código de antes ... */ 
            const filtered = allDevices.filter(d => d.name.toLowerCase().includes(term) || (d.licensePlate || "").toLowerCase().includes(term));
            this.renderCards(filtered);
        }
    };
};
