geotab.addin.adBlueReport = (api, state) => {
    const DIAGNOSTIC_ADBLUE_ID = "DiagnosticDieselExhaustFluidId";
    let allDevices = [];
    let allStatusData = [];
    let calculatedResults = []; 

    return {
        initialize(api, state, callback) {
            const today = new Date();
            const lastMonth = new Date();
            lastMonth.setDate(today.getDate() - 30);

            document.getElementById("dateTo").value = today.toISOString().slice(0, 16);
            document.getElementById("dateFrom").value = lastMonth.toISOString().slice(0, 16);

            document.getElementById("refreshBtn").addEventListener("click", () => this.updateReport(api));
            document.getElementById("exportBtn").addEventListener("click", () => this.downloadCSV());
            document.getElementById("searchInput").addEventListener("input", (e) => this.filterAndRender(e.target.value.toLowerCase()));

            this.updateReport(api);
            callback();
        },

        async updateReport(api) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = '<div class="loading-shimmer">Calculando consumos y sumando registros históricos...</div>';

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
                    }]
                ]);

                allDevices = results[0];
                allStatusData = results[1];
                this.processData();
                this.renderCards(allDevices);
            } catch (error) {
                container.innerHTML = `<p style="color:red">Error API: ${error.message}</p>`;
            }
        },

        processData() {
            // Convertimos los límites del input a objetos Date para comparar
            const fromLimit = new Date(document.getElementById("dateFrom").value);
            const toLimit = new Date(document.getElementById("dateTo").value);

            calculatedResults = allDevices.map(device => {
                // 1. Lógica de Sensores
                const data = allStatusData
                    .filter(d => d.device.id === device.id)
                    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

                let totalSensorConsumed = 0;
                let lastLevel = null;
                data.forEach(p => {
                    if (lastLevel !== null) {
                        const diff = lastLevel - p.data;
                        if (diff > 0) totalSensorConsumed += diff;
                    }
                    lastLevel = p.data;
                });

                // 2. LÓGICA DE SUMATORIA MANUAL (CORREGIDA)
                let sumaLitrosPeriodo = 0;
                let conteoRegistros = 0;

                if (device.comment) {
                    /**
                     * EXPLICACIÓN REGEX:
                     * \[         -> Busca el corchete de apertura
                     * (\d{1,2})  -> Grupo 1: Día
                     * \/         -> La barra inclinada
                     * (\d{1,2})  -> Grupo 2: Mes
                     * [^->]* -> Ignora cualquier cosa (coma, hora) hasta llegar a...
                     * ->         -> La flecha
                     * \s* -> Espacios opcionales
                     * (\d+)      -> Grupo 3: Litros (los números)
                     * \s*L       -> Espacio opcional y la letra L
                     * \]         -> Corchete de cierre
                     */
                    const regexGlobal = /\[(\d{1,2})\/(\d{1,2})[^->]*->\s*(\d+)\s*L\]/g;
                    let match;

                    while ((match = regexGlobal.exec(device.comment)) !== null) {
                        const dia = parseInt(match[1]);
                        const mes = parseInt(match[2]) - 1; // Enero es 0
                        const litros = parseInt(match[3]);

                        // Creamos la fecha del registro usando el año del filtro "Hasta"
                        const fechaRegistro = new Date(toLimit.getFullYear(), mes, dia);
                        
                        // Si el mes del registro es mayor al mes del filtro "Hasta", 
                        // probablemente el registro es del año pasado (ej: registro en Dic, filtro en Ene)
                        if (fechaRegistro > toLimit) {
                            fechaRegistro.setFullYear(fechaRegistro.getFullYear() - 1);
                        }

                        // Comparación estricta de tiempo (setHours 0,0,0,0 para comparar solo días si es necesario)
                        if (fechaRegistro >= fromLimit && fechaRegistro <= toLimit) {
                            sumaLitrosPeriodo += litros;
                            conteoRegistros++;
                        }
                    }
                }

                return {
                    id: device.id,
                    name: device.name,
                    plate: device.licensePlate || "N/A",
                    currentLevel: data.length ? Math.round(data[data.length - 1].data) : null,
                    consumed: Math.round(totalSensorConsumed * 10) / 10,
                    hasData: data.length > 0,
                    totalManualLiters: sumaLitrosPeriodo,
                    numManualRecords: conteoRegistros
                };
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

                let status = "no-data";
                if (res.currentLevel !== null) {
                    status = res.currentLevel < 10 ? "critical" : (res.currentLevel < 20 ? "warning" : "ok");
                }

                const card = document.createElement("div");
                card.className = `vehicle-card ${status}`;
                
                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between">
                        <strong>${res.name}</strong>
                    </div>
                    <p style="font-size:0.8em; color:#666; margin:5px 0;">Matrícula: ${res.plate}</p>
                    
                    <div style="margin:10px 0">
                        <small>Nivel Actual: ${res.currentLevel ?? '--'}%</small>
                        <div style="background:#eee; height:8px; border-radius:4px">
                            <div style="width:${res.currentLevel || 0}%; background:${this.getBarColor(res.currentLevel)}; height:100%; border-radius:4px"></div>
                        </div>
                    </div>

                    <div class="manual-refill-box" style="border-left: 4px solid ${res.totalManualLiters > 0 ? '#27ae60' : '#ccc'}; background: #f9f9f9; padding: 8px; margin: 10px 0; border-radius: 4px;">
                        <div style="font-size: 0.75em; color: #333; font-weight:bold; margin-bottom:2px;">
                            📋 Rellenos en este periodo
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:end;">
                            <span style="font-size: 1.3em; font-weight:bold; color: #2e7d32;">${res.totalManualLiters} L</span>
                            <span style="font-size: 0.7em; color: #666;">${res.numManualRecords} envíos</span>
                        </div>
                    </div>

                    <div class="consumption-box" style="background:#f0f7ff; padding:8px; border-radius:4px; border: 1px dashed #2440b2;">
                        <small>Consumo Sensor (%):</small>
                        <div style="font-size:1.1em; font-weight:bold; color:#2440b2;">
                            ${res.hasData ? res.consumed + '%' : 'Sin datos'}
                        </div>
                    </div>
                `;
                container.appendChild(card);
            });

            document.getElementById("count-critical").innerText = criticals;
        },

        getBarColor(lvl) {
            if (lvl === null) return "#ccc";
            if (lvl < 10) return "#e74c3c";
            if (lvl < 20) return "#f39c12";
            return "#27ae60";
        },

        filterAndRender(term) {
            const filtered = allDevices.filter(d => d.name.toLowerCase().includes(term) || (d.licensePlate || "").toLowerCase().includes(term));
            this.renderCards(filtered);
        },

        downloadCSV() {
            let csv = "data:text/csv;charset=utf-8,Vehiculo,Matricula,Nivel %,Consumo %,Total Litros Manual (Periodo),Num Reportes\n";
            calculatedResults.forEach(r => {
                csv += `"${r.name}","${r.plate}","${r.currentLevel ?? ''}","${r.consumed}","${r.totalManualLiters}","${r.numManualRecords}"\n`;
            });
            const link = document.createElement("a");
            link.setAttribute("href", encodeURI(csv));
            link.setAttribute("download", `AdBlue_Detalle.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };
};
