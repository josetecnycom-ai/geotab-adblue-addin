geotab.addin.adBlueReport = (api, state) => {
    
    // Configuración
    const DIAGNOSTIC_ADBLUE_ID = "DiagnosticDieselExhaustFluidId";
    
    // Variables globales para almacenamiento temporal
    let allDevices = [];
    let allStatusData = [];

    return {
        /**
         * Inicialización del Add-In
         */
        initialize(api, state, callback) {
            console.log("Iniciando Add-In de AdBlue...");
            
            // 1. Cargar datos iniciales
            this.updateReport(api);
            
            // 2. Configurar eventos de botones y buscador
            document.getElementById("refreshBtn").addEventListener("click", () => {
                this.updateReport(api);
            });

            document.getElementById("exportBtn").addEventListener("click", () => {
                this.downloadCSV();
            });

            document.getElementById("searchInput").addEventListener("input", (e) => {
                this.filterAndRender(e.target.value.toLowerCase());
            });

            callback();
        },

        /**
         * Obtener datos de la API de Geotab
         */
        async updateReport(api) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = '<div class="loading-shimmer">Consultando niveles de flota...</div>';

            try {
                // Llamada optimizada (Multicall)
                const results = await api.multiCall([
                    ["Get", { typeName: "Device" }],
                    ["Get", { 
                        typeName: "StatusData", 
                        search: { diagnosticSearch: { id: DIAGNOSTIC_ADBLUE_ID } } 
                    }]
                ]);

                allDevices = results[0];
                allStatusData = results[1];

                // Renderizar todo inicialmente
                this.renderCards(allDevices, allStatusData);
                this.updateSummary(allStatusData);

            } catch (error) {
                console.error("Error Geotab:", error);
                container.innerHTML = `<p style="color:red; text-align:center;">Error al cargar datos: ${error.message}</p>`;
            }
        },

        /**
         * Filtrar vehículos en memoria (Buscador)
         */
        filterAndRender(term) {
            if (!allDevices.length) return;

            const filtered = allDevices.filter(device => {
                const name = (device.name || "").toLowerCase();
                const plate = (device.licensePlate || "").toLowerCase();
                return name.includes(term) || plate.includes(term);
            });

            this.renderCards(filtered, allStatusData);
        },

        /**
         * Generar el HTML de las tarjetas
         */
        renderCards(devices, statusDataList) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = "";

            if (devices.length === 0) {
                container.innerHTML = '<p style="text-align:center; width:100%; color:#999;">No se encontraron vehículos.</p>';
                return;
            }

            devices.forEach(device => {
                // Buscar el último dato para este vehículo
                const latest = statusDataList
                    .filter(d => d.device.id === device.id)
                    .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime))[0];

                const hasData = latest && latest.data !== null;
                const level = hasData ? Math.round(latest.data) : null;
                
                // Determinar colores
                let statusClass = "no-data";
                let barColor = "#bdc3c7";

                if (hasData) {
                    if (level < 10) { statusClass = "critical"; barColor = "#e74c3c"; }
                    else if (level < 20) { statusClass = "warning"; barColor = "#f39c12"; }
                    else { statusClass = "ok"; barColor = "#27ae60"; }
                }

                // Crear elemento HTML
                const card = document.createElement("div");
                card.className = `vehicle-card ${statusClass}`;
                
                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <span class="vehicle-name"><strong>${device.name}</strong></span>
                        ${!hasData ? '<span class="no-data-badge">Sin Sensor</span>' : ''}
                    </div>
                    
                    <div class="level-container" style="margin-top: 10px;">
                        <div class="progress-bar-bg" style="background: #eee; height: 10px; border-radius: 5px; overflow: hidden;">
                            <div class="progress-fill" style="width: ${level || 0}%; background: ${barColor}; height: 100%;"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.9em; margin-top: 5px; color: #555;">
                            <span>${hasData ? level + '%' : '--'}</span>
                            <small>${device.licensePlate || ''}</small>
                        </div>
                    </div>
                `;
                container.appendChild(card);
            });
        },

        /**
         * Actualizar contadores superiores
         */
        updateSummary(statusData) {
            const levels = statusData.map(d => d.data);
            const critical = levels.filter(l => l < 10).length;
            const avg = levels.length ? (levels.reduce((a, b) => a + b, 0) / levels.length).toFixed(1) : 0;

            const elCrit = document.getElementById("count-critical");
            const elAvg = document.getElementById("avg-level");
            
            if(elCrit) elCrit.innerText = critical;
            if(elAvg) elAvg.innerText = avg + "%";
        },

        /**
         * Exportar a Excel (CSV)
         */
        downloadCSV() {
            if (!allDevices || allDevices.length === 0) {
                alert("Espera a que carguen los datos.");
                return;
            }

            let csvContent = "data:text/csv;charset=utf-8,";
            // Cabeceras
            csvContent += "Vehiculo,Matricula,Nivel AdBlue (%),Estado,Fecha Lectura\n";

            allDevices.forEach(device => {
                const latest = allStatusData
                    .filter(d => d.device.id === device.id)
                    .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime))[0];

                const level = latest ? Math.round(latest.data) : "";
                const dateRaw = latest ? new Date(latest.dateTime) : null;
                const dateStr = dateRaw ? dateRaw.toLocaleDateString() + " " + dateRaw.toLocaleTimeString() : "Sin datos";
                
                let statusText = "Sin datos";
                if (level !== "") {
                    if (level < 10) statusText = "CRITICO";
                    else if (level < 20) statusText = "BAJO";
                    else statusText = "OK";
                }

                // Construir fila CSV
                const row = `"${device.name}","${device.licensePlate || ''}","${level}","${statusText}","${dateStr}"`;
                csvContent += row + "\n";
            });

            // Descarga
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `Reporte_AdBlue_${new Date().toISOString().slice(0,10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };
};


