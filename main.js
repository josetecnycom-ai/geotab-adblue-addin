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
      // ... dentro de tu objeto adBlueReport ...

renderCards(devices, statusDataList) {
    const container = document.getElementById("vehicleGrid");
    container.innerHTML = ""; 

    devices.forEach(device => {
        // Buscamos el último dato
        const latest = statusDataList
            .filter(d => d.device.id === device.id)
            .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime))[0];

        // Verificamos si existe el dato
        const hasData = latest !== undefined && latest.data !== null;
        const level = hasData ? Math.round(latest.data) : null;
        
        // Determinamos la clase visual
        let statusClass = "no-data";
        let barColor = "#bdc3c7";

        if (hasData) {
            if (level < 10) { statusClass = "critical"; barColor = "#e74c3c"; }
            else if (level < 20) { statusClass = "warning"; barColor = "#f39c12"; }
            else { statusClass = "ok"; barColor = "#27ae60"; }
        }

        const card = document.createElement("div");
        card.className = `vehicle-card ${statusClass}`;
        
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <span class="vehicle-name"><strong>${device.name}</strong></span>
                ${!hasData ? '<span class="no-data-badge">Sin Sensor</span>' : ''}
            </div>
            
            <div class="level-container" style="margin-top: 10px;">
                <div class="progress-bar-bg" style="background: #eee; height: 10px; border-radius: 5px; overflow: hidden;">
                    <div class="progress-fill" style="width: ${level || 0}%; background: ${barColor}; height: 100%; transition: width 0.5s;"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.9em; margin-top: 5px;">
                    <span>${hasData ? level + '%' : 'Nivel desconocido'}</span>
                    <small style="color: #95a5a6;">${device.licensePlate || 'Sin placa'}</small>
                </div>
            </div>
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

