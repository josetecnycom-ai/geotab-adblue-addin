/**
 * Add-In de Monitoreo de AdBlue para Geotab
 */
geotab.addin.adBlueReport = (api, state) => {
    
    // ID estándar de Geotab para el nivel de AdBlue (DEF)
    const DIAGNOSTIC_ADBLUE_ID = "DiagnosticDieselExhaustFluidId";

    return {
        /**
         * initialize se ejecuta una sola vez cuando se carga el Add-In.
         */
        initialize(api, state, callback) {
            console.log("Add-In de AdBlue inicializado.");
            // Dibujamos el estado inicial
            this.updateReport(api);
            
            // Configurar el botón de actualización
            document.getElementById("refreshBtn").addEventListener("click", () => {
                this.updateReport(api);
            });

            callback();
        },

        /**
         * updateReport obtiene los datos y actualiza el DOM.
         */
        async updateReport(api) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = '<div class="loading-shimmer">Consultando niveles de flota...</div>';

            try {
                // Usamos multiCall para pedir Vehículos y sus niveles de AdBlue en un solo viaje
                const results = await api.multiCall([
                    ["Get", { typeName: "Device" }],
                    ["Get", { 
                        typeName: "StatusData", 
                        search: { 
                            diagnosticSearch: { id: DIAGNOSTIC_ADBLUE_ID }
                        } 
                    }]
                ]);

                const devices = results[0];
                const statusDataList = results[1];

                this.renderCards(devices, statusDataList);
                this.updateSummary(statusDataList);

            } catch (error) {
                console.error("Error obteniendo datos de Geotab:", error);
                container.innerHTML = `<p class="error">Error al cargar datos: ${error.message}</p>`;
            }
        },

        /**
         * renderCards crea el HTML dinámico para los 30 vehículos.
         */
        renderCards(devices, statusDataList) {
            const container = document.getElementById("vehicleGrid");
            container.innerHTML = ""; // Limpiar cargando

            devices.forEach(device => {
                // Buscamos el último dato de AdBlue para este vehículo específico
                const latestData = statusDataList
                    .filter(data => data.device.id === device.id)
                    .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime))[0];

                const level = latestData ? Math.round(latestData.data) : null;
                const statusClass = this.getStatusClass(level);
                
                const card = document.createElement("div");
                card.className = `vehicle-card ${statusClass}`;
                
                card.innerHTML = `
                    <span class="vehicle-name">${device.name}</span>
                    <div class="level-container">
                        <div class="progress-bar-bg">
                            <div class="progress-fill" style="width: ${level ?? 0}%; background-color: ${this.getColor(statusClass)}"></div>
                        </div>
                        <div class="status-text">
                            <span>${level !== null ? level + '%' : 'Sin datos'}</span>
                            <span>AdBlue</span>
                        </div>
                    </div>
                    <small>Matrícula: ${device.licensePlate || 'N/A'}</small>
                `;
                container.appendChild(card);
            });
        },

        /**
         * Lógica de colores según el nivel
         */
        getStatusClass(level) {
            if (level === null) return "ok";
            if (level < 10) return "critical";
            if (level < 20) return "warning";
            return "ok";
        },

        getColor(status) {
            if (status === "critical") return "#e74c3c";
            if (status === "warning") return "#f39c12";
            return "#27ae60";
        },

        updateSummary(statusData) {
            const levels = statusData.map(d => d.data);
            const criticalCount = levels.filter(l => l < 10).length;
            const avg = levels.length ? (levels.reduce((a, b) => a + b, 0) / levels.length).toFixed(1) : 0;

            document.getElementById("count-critical").innerText = criticalCount;
            document.getElementById("avg-level").innerText = avg + "%";
        }
    };

};
