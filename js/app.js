// Main Tactical Simulation Coordinator

class HiveSightApp {
    constructor() {
        this.map = new TacticalMap();
        
        // Canvas setups
        this.mapCanvas = document.getElementById('tacticalCanvas');
        this.visorCanvas = document.getElementById('visorCanvas');
        this.renderer = new TacticalRenderer(this.mapCanvas, this.visorCanvas);
        
        // Simulation state
        this.entities = [];
        this.selectedId = 'SLD-01';
        this.hudEnabled = true;
        this.uplinkRateHz = 15;
        this.isWanderingEnemies = false;
        
        // Hive mind tracks
        this.hiveTracks = { allies: [], enemies: [] };
        
        // Server state
        this.serverOffline = false;
        this.localHiveMind = null; // Fallback local engine

        // Drag and drop state
        this.draggedEntity = null;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;

        // Key states
        this.keys = {};

        // Network timers
        this.networkInterval = null;
        this.lastTime = 0;

        // Initial setup
        this.initEntities();
        this.setupEventListeners();
        this.startNetworkLoop();
        this.addLog("SYSTEM initialized. Searching for Hive Fusion Server...");
        
        // Start animation loop
        requestAnimationFrame((t) => this.loop(t));
    }

    initEntities() {
        // Clear array
        this.entities = [];

        // Spawn 3 allies (Soldiers) in open areas
        const s1Pos = { x: 2.5, y: 2.5 };
        const s2Pos = { x: 13.5, y: 1.5 };
        const s3Pos = { x: 7.5, y: 7.5 };

        this.entities.push(new Soldier('SLD-01', s1Pos.x, s1Pos.y, 0, this.renderer.colors.ally));
        this.entities.push(new Soldier('SLD-02', s2Pos.x, s2Pos.y, Math.PI, this.renderer.colors.ally));
        this.entities.push(new Soldier('SLD-03', s3Pos.x, s3Pos.y, -Math.PI / 2, this.renderer.colors.ally));

        // Disable autopatrol for SLD-01 by default so the user can steer it manually right away!
        this.entities[0].autoPatrol = false;

        // Spawn 1 Drone
        this.entities.push(new Drone('DRN-01', 8.0, 8.0, this.renderer.colors.drone));

        // Spawn 3 Enemies (static targets initially)
        this.entities.push(new Enemy('ENM-01', 3.5, 4.5, this.renderer.colors.enemy));
        this.entities.push(new Enemy('ENM-02', 12.5, 9.5, this.renderer.colors.enemy));
        this.entities.push(new Enemy('ENM-03', 8.5, 12.5, this.renderer.colors.enemy));
    }

    setupEventListeners() {
        // Keyboard tracking
        window.addEventListener('keydown', (e) => {
            this.keys[e.key] = true;
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.key] = false;
        });

        // Mouse drags on Tactical Map
        const getMousePos = (canvas, evt) => {
            const rect = canvas.getBoundingClientRect();
            return {
                x: evt.clientX - rect.left,
                y: evt.clientY - rect.top
            };
        };

        const getGridCoordsFromMouse = (x, y) => {
            const width = this.mapCanvas.width;
            const height = this.mapCanvas.height;
            const cellSize = Math.min(width / this.map.cols, height / this.map.rows);
            const offsetX = (width - this.map.cols * cellSize) / 2;
            const offsetY = (height - this.map.rows * cellSize) / 2;
            
            return {
                x: (x - offsetX) / cellSize,
                y: (y - offsetY) / cellSize
            };
        };

        this.mapCanvas.addEventListener('mousedown', (e) => {
            const mouse = getMousePos(this.mapCanvas, e);
            const grid = getGridCoordsFromMouse(mouse.x, mouse.y);

            // Find closest entity (within 0.6 grid cells)
            let closest = null;
            let minDist = 0.6;

            this.entities.forEach(ent => {
                const dx = ent.x - grid.x;
                const dy = ent.y - grid.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist < minDist) {
                    minDist = dist;
                    closest = ent;
                }
            });

            if (closest) {
                if (closest.role === 'soldier') {
                    // Select soldier
                    this.selectedId = closest.id;
                    this.addLog(`Selected Perspective: ${closest.id}`);
                    
                    // Update dropdown
                    const sel = document.getElementById('soldierSelect');
                    if (sel) sel.value = closest.id;

                    // Sync autopatrol toggle UI checkbox
                    const check = document.getElementById('autoPatrolCheck');
                    if (check) check.checked = closest.autoPatrol;
                } else if (closest.role === 'enemy') {
                    // Drag enemy
                    this.draggedEntity = closest;
                    this.dragOffsetX = closest.x - grid.x;
                    this.dragOffsetY = closest.y - grid.y;
                    this.addLog(`Moving enemy ${closest.id}`);
                }
            } else {
                // If empty area clicked, move selected soldier to clicked spot
                const selected = this.entities.find(e => e.id === this.selectedId);
                if (selected && grid.x > 0 && grid.x < this.map.cols && grid.y > 0 && grid.y < this.map.rows) {
                    if (!this.map.isWall(Math.floor(grid.x), Math.floor(grid.y))) {
                        selected.x = grid.x;
                        selected.y = grid.y;
                        selected.patrolPoints = []; // reset patrol
                        this.addLog(`Dispatched ${selected.id} to tactical grid coords (${grid.x.toFixed(1)}, ${grid.y.toFixed(1)})`);
                    }
                }
            }
        });

        this.mapCanvas.addEventListener('mousemove', (e) => {
            if (this.draggedEntity) {
                const mouse = getMousePos(this.mapCanvas, e);
                const grid = getGridCoordsFromMouse(mouse.x, mouse.y);
                const newX = grid.x + this.dragOffsetX;
                const newY = grid.y + this.dragOffsetY;
                
                // Allow free drag, clamp to bounds
                this.draggedEntity.x = Math.max(1.0, Math.min(this.map.cols - 1.0, newX));
                this.draggedEntity.y = Math.max(1.0, Math.min(this.map.rows - 1.0, newY));
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.draggedEntity) {
                this.addLog(`Enemy ${this.draggedEntity.id} positioned at (${this.draggedEntity.x.toFixed(1)}, ${this.draggedEntity.y.toFixed(1)})`);
                this.draggedEntity = null;
            }
        });

        // Setup HTML Controls Event Listeners
        document.getElementById('hudToggle').addEventListener('change', (e) => {
            this.hudEnabled = e.target.checked;
            this.addLog(`AR Helmet Visor HUD: ${this.hudEnabled ? 'ENABLED' : 'DISABLED'}`);
        });

        document.getElementById('soldierSelect').addEventListener('change', (e) => {
            this.selectedId = e.target.value;
            this.addLog(`Switched perspective to ${this.selectedId}`);
            
            // Sync checkbox
            const selected = this.entities.find(ent => ent.id === this.selectedId);
            if (selected) {
                document.getElementById('autoPatrolCheck').checked = selected.autoPatrol;
            }
        });

        document.getElementById('autoPatrolCheck').addEventListener('change', (e) => {
            const selected = this.entities.find(ent => ent.id === this.selectedId);
            if (selected) {
                selected.autoPatrol = e.target.checked;
                selected.patrolPoints = []; // reset patrol
                this.addLog(`${selected.id} Auto Patrol: ${selected.autoPatrol ? 'ENABLED' : 'DISABLED'}`);
            }
        });

        document.getElementById('enemyMoveCheck').addEventListener('change', (e) => {
            this.isWanderingEnemies = e.target.checked;
            this.entities.forEach(ent => {
                if (ent.role === 'enemy') {
                    ent.isWandering = this.isWanderingEnemies;
                    ent.targetPoint = null;
                }
            });
            this.addLog(`Tactical Enemy Wander AI: ${this.isWanderingEnemies ? 'ACTIVE' : 'STATIC'}`);
        });

        document.getElementById('uplinkRateSelect').addEventListener('change', (e) => {
            this.uplinkRateHz = parseInt(e.target.value);
            this.startNetworkLoop();
            this.addLog(`Tactical Data Link frequency updated to ${this.uplinkRateHz}Hz`);
        });

        document.getElementById('btnSpawnEnemy').addEventListener('click', () => {
            const rnd = this.map.getRandomEmptyPosition();
            const count = this.entities.filter(ent => ent.role === 'enemy').length + 1;
            const newEnemy = new Enemy(`ENM-${count.toString().padStart(2, '0')}`, rnd.x, rnd.y, this.renderer.colors.enemy);
            newEnemy.isWandering = this.isWanderingEnemies;
            this.entities.push(newEnemy);
            this.addLog(`Dispatched additional ENEMY target ${newEnemy.id} at grid (${rnd.x.toFixed(1)}, ${rnd.y.toFixed(1)})`);
        });

        document.getElementById('btnSpawnSoldier').addEventListener('click', () => {
            const rnd = this.map.getRandomEmptyPosition();
            const count = this.entities.filter(ent => ent.role === 'soldier').length + 1;
            const newSoldier = new Soldier(`SLD-${count.toString().padStart(2, '0')}`, rnd.x, rnd.y, 0, this.renderer.colors.ally);
            this.entities.push(newSoldier);
            
            // Add option to select list
            const sel = document.getElementById('soldierSelect');
            const opt = document.createElement('option');
            opt.value = newSoldier.id;
            opt.textContent = newSoldier.id;
            sel.appendChild(opt);

            this.addLog(`Deployed additional Tactical Soldier ${newSoldier.id} at grid (${rnd.x.toFixed(1)}, ${rnd.y.toFixed(1)})`);
        });

        document.getElementById('btnReset').addEventListener('click', () => {
            this.initEntities();
            
            // Re-sync select list options
            const sel = document.getElementById('soldierSelect');
            sel.innerHTML = '';
            this.entities.filter(e => e.role === 'soldier').forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.id;
                sel.appendChild(opt);
            });
            sel.value = this.selectedId = 'SLD-01';
            document.getElementById('autoPatrolCheck').checked = false;
            document.getElementById('enemyMoveCheck').checked = false;
            this.isWanderingEnemies = false;

            this.addLog("Rescinding all tracks, clearing Hive Mind, and resetting simulation...");
            
            if (this.serverOffline) {
                this.localHiveMind.reset();
            } else {
                fetch('/api/reset', { method: 'POST' }).catch(() => {});
            }
        });
    }

    addLog(msg) {
        const consoleFeed = document.getElementById('consoleFeed');
        if (!consoleFeed) return;

        const timeStr = new Date().toLocaleTimeString();
        const line = document.createElement('div');
        line.className = 'console-line';
        if (msg.includes('[HIVE') || msg.includes('fused')) {
            line.style.color = '#00ff66';
        } else if (msg.includes('ENEMY') || msg.includes('warning') || msg.includes('PENETRATING')) {
            line.style.color = '#ff2a5f';
        }
        line.innerHTML = `<span class="console-timestamp">[${timeStr}]</span> ${msg}`;
        consoleFeed.appendChild(line);
        consoleFeed.scrollTop = consoleFeed.scrollHeight;
    }

    // ----------------------------------------------------
    // Client-Side Hive Mind Mock Server (Local Fallback)
    // ----------------------------------------------------
    setupLocalHiveMind() {
        this.localHiveMind = {
            allies: {},
            enemies: {},
            nextTrackIdx: 1,
            
            report(data) {
                const now = Date.now() / 1000;
                const entityId = data.id;
                const role = data.role;
                const rx = data.x;
                const ry = data.y;
                const ryaw = data.yaw;

                // Log self telemetry
                this.allies[entityId] = {
                    id: entityId,
                    type: role,
                    x: rx,
                    y: ry,
                    yaw: ryaw,
                    last_seen: now
                };

                // Log visual detections
                if (data.detections) {
                    data.detections.forEach(det => {
                        const globalAngle = ryaw + det.rel_bearing;
                        const estX = rx + det.rel_dist * Math.cos(globalAngle);
                        const estY = ry + det.rel_dist * Math.sin(globalAngle);

                        if (det.type === 'enemy') {
                            let fused = false;
                            for (const tid in this.enemies) {
                                const track = this.enemies[tid];
                                const dx = track.x - estX;
                                const dy = track.y - estY;
                                const dist = Math.sqrt(dx*dx + dy*dy);
                                if (dist < 1.2) {
                                    track.x = track.x * 0.7 + estX * 0.3;
                                    track.y = track.y * 0.7 + estY * 0.3;
                                    track.last_seen = now;
                                    if (!track.sources.includes(entityId)) {
                                        track.sources.push(entityId);
                                    }
                                    fused = true;
                                    break;
                                }
                            }
                            if (!fused) {
                                const trackId = `TRK-${this.nextTrackIdx.toString().padStart(2, '0')}`;
                                this.nextTrackIdx++;
                                this.enemies[trackId] = {
                                    id: trackId,
                                    type: 'enemy',
                                    x: estX,
                                    y: estY,
                                    last_seen: now,
                                    sources: [entityId]
                                };
                            }
                        }
                    });
                }
            },

            getTracks() {
                const now = Date.now() / 1000;
                // Decay
                for (const tid in this.enemies) {
                    if (now - this.enemies[tid].last_seen > 3.0) {
                        delete this.enemies[tid];
                    }
                }
                for (const aid in this.allies) {
                    if (now - this.allies[aid].last_seen > 5.0) {
                        delete this.allies[aid];
                    }
                }
                return {
                    allies: Object.values(this.allies),
                    enemies: Object.values(this.enemies)
                };
            },

            reset() {
                this.allies = {};
                this.enemies = {};
                this.nextTrackIdx = 1;
            }
        };
    }

    // ----------------------------------------------------
    // Uplink Network Loop (Pings Python backend or fallback)
    // ----------------------------------------------------
    startNetworkLoop() {
        if (this.networkInterval) {
            clearInterval(this.networkInterval);
        }

        const runUplink = () => {
            // Send telemetry reports for all soldiers and drone
            const reporters = this.entities.filter(ent => ent.role === 'soldier' || ent.role === 'drone');
            
            reporters.forEach(ent => {
                const telemetry = ent.getTelemetry();

                if (this.serverOffline) {
                    this.localHiveMind.report(telemetry);
                } else {
                    // POST request to Python Server
                    fetch('/api/report', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(telemetry)
                    }).catch((err) => {
                        this.activateLocalFallback(err);
                    });
                }
            });

            // Retrieve Fused tracks
            if (this.serverOffline) {
                this.hiveTracks = this.localHiveMind.getTracks();
                
                // Show telemetry report updates in log occasionally
                if (Math.random() < 0.1) {
                    const activeT = this.hiveTracks.enemies.length;
                    this.addLog(`[LOCAL HIVE] Fused Active Tracks: ${activeT} enemies, ${this.hiveTracks.allies.length} allies.`);
                }
            } else {
                fetch('/api/tracks')
                    .then(res => res.json())
                    .then(data => {
                        this.hiveTracks = data;
                        if (Math.random() < 0.1) {
                            this.addLog(`[HIVE UPLINK] Telemetry synced. Active tracks: ${data.enemies.length} enemies, ${data.allies.length} allies.`);
                        }
                    })
                    .catch((err) => {
                        this.activateLocalFallback(err);
                    });
            }
        };

        this.networkInterval = setInterval(runUplink, 1000 / this.uplinkRateHz);
    }

    activateLocalFallback(err) {
        if (!this.serverOffline) {
            this.serverOffline = true;
            this.setupLocalHiveMind();
            this.addLog(`[WARNING] Connection to Python Server lost/offline. Switching to Local Client-Side Mock Server.`);
            console.warn("Switching to offline local Hive Mind mock server due to:", err);
        }
    }

    // ----------------------------------------------------
    // Main 60fps Game/Simulation Frame Loop
    // ----------------------------------------------------
    loop(timestamp) {
        if (!this.lastTime) this.lastTime = timestamp;
        let dt = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;

        // Cap dt to prevent massive jumps when tab is inactive
        if (dt > 0.1) dt = 0.1;

        // 1. Update Entities
        this.entities.forEach(ent => {
            if (ent.role === 'soldier') {
                const isSelected = ent.id === this.selectedId;
                ent.update(dt, this.map, this.keys, isSelected);
            } else {
                ent.update(dt, this.map);
            }
        });

        // 2. Perform Sensor Sweeps
        this.entities.forEach(ent => {
            if (ent.role === 'soldier' || ent.role === 'drone') {
                ent.performSensorSweep(this.entities, this.map);
            }
        });

        // 3. Render Displays
        // 2D Tactical Map
        this.renderer.renderTacticalMap(
            this.map, 
            this.entities, 
            this.hiveTracks, 
            this.selectedId, 
            4.5, 
            this.draggedEntity
        );

        // 3D Helmet Raycast Visor View
        const observer = this.entities.find(e => e.id === this.selectedId);
        if (observer) {
            this.renderer.renderVisor(
                observer, 
                this.map, 
                this.entities, 
                this.hiveTracks, 
                this.hudEnabled
            );
        }

        requestAnimationFrame((t) => this.loop(t));
    }
}

// Instantiate App on window load
window.addEventListener('load', () => {
    window.app = new HiveSightApp();
});
