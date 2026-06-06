// Tactical Renderer for Tactical Map (2D) and Headset Visor (3D Raycaster)

class TacticalRenderer {
    constructor(mapCanvas, visorCanvas) {
        this.mapCanvas = mapCanvas;
        this.mCtx = mapCanvas.getContext('2d');
        
        this.visorCanvas = visorCanvas;
        this.vCtx = visorCanvas.getContext('2d');

        // Raycasting config
        this.fov = Math.PI / 3; // 60 degrees
        this.zBuffer = new Float32Array(visorCanvas.width);
        
        // Colors
        this.colors = {
            bgDark: '#0a0d14',
            gridLine: 'rgba(0, 168, 204, 0.05)',
            wall: '#161c28',
            wallGlow: '#00a8cc',
            ally: '#00e5ff',
            allyGlow: 'rgba(0, 229, 255, 0.2)',
            enemy: '#ff2a5f',
            enemyGlow: 'rgba(255, 42, 95, 0.2)',
            drone: '#ffea00',
            droneGlow: 'rgba(255, 234, 0, 0.15)',
            text: '#e3e8f0',
            textDim: '#7a889b',
            hudGreen: '#00ff66',
            hudGreenDim: 'rgba(0, 255, 102, 0.4)'
        };

        // Check if Three.js is loaded from CDN
        this.is3D = typeof window.THREE !== 'undefined' && typeof window.THREE.OrbitControls !== 'undefined';
        if (this.is3D) {
            this.init3D();
        }
    }

    init3D() {
        const THREE = window.THREE;
        
        // Hide 2D canvas and get wrapper
        this.mapCanvas.style.display = 'none';
        this.threeContainer = this.mapCanvas.parentElement;

        // WebGL Renderer setup
        this.threeRenderer = new THREE.WebGLRenderer({ antialias: true });
        this.threeRenderer.setSize(this.mapCanvas.width, this.mapCanvas.height);
        this.threeRenderer.shadowMap.enabled = true;
        this.threeContainer.appendChild(this.threeRenderer.domElement);

        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#060a12');
        this.scene.fog = new THREE.FogExp2(0x060a12, 0.015);

        // Camera setup (slanted tactical view)
        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
        this.camera.position.set(8, -6, 13);
        this.camera.up.set(0, 0, 1); // Z-axis is UP

        // OrbitControls
        this.controls = new THREE.OrbitControls(this.camera, this.threeRenderer.domElement);
        this.controls.target.set(8, 8, 0);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Do not go below floor
        this.controls.minDistance = 3;
        this.controls.maxDistance = 30;
        this.controls.update();

        // Lighting
        const ambientLight = new THREE.AmbientLight(0x0b162a, 2.5);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0x00e5ff, 2.0);
        dirLight.position.set(10, -10, 25);
        dirLight.castShadow = true;
        this.scene.add(dirLight);

        // Grid plane helper
        const gridHelper = new THREE.GridHelper(16, 16, 0x00e5ff, 0x00a8cc);
        gridHelper.rotation.x = Math.PI / 2;
        gridHelper.position.set(8, 8, 0.01);
        gridHelper.material.opacity = 0.15;
        gridHelper.material.transparent = true;
        this.scene.add(gridHelper);

        // Ground plane mesh
        const groundGeo = new THREE.PlaneGeometry(35, 35);
        const groundMat = new THREE.MeshPhongMaterial({ color: 0x03060c, shininess: 10 });
        const groundMesh = new THREE.Mesh(groundGeo, groundMat);
        groundMesh.position.set(8, 8, 0);
        groundMesh.receiveShadow = true;
        this.scene.add(groundMesh);

        // Raycasting support
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Mesh registries
        this.wallMeshes = [];
        this.entityGroups = {};
        this.targetTracks = {};
        this.sightCones = {};
        this.connectionLines = [];
        this.is3DInitialized = false;
    }

    build3DWalls(map) {
        const THREE = window.THREE;
        
        for (let r = 0; r < map.rows; r++) {
            for (let c = 0; c < map.cols; c++) {
                if (map.grid[r][c] === 1) {
                    // Create extruded box geometry (holographic building)
                    const wallGeo = new THREE.BoxGeometry(0.96, 0.96, 1.8);
                    const wallMat = new THREE.MeshPhongMaterial({
                        color: 0x0f172a,
                        transparent: true,
                        opacity: 0.8,
                        shininess: 30
                    });
                    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
                    wallMesh.position.set(c + 0.5, r + 0.5, 0.9);
                    wallMesh.castShadow = true;
                    wallMesh.receiveShadow = true;
                    this.scene.add(wallMesh);
                    this.wallMeshes.push(wallMesh);

                    // Holographic neon edge lines
                    const edges = new THREE.EdgesGeometry(wallGeo);
                    const lineMat = new THREE.LineBasicMaterial({ color: 0x00a8cc });
                    const line = new THREE.LineSegments(edges, lineMat);
                    line.position.copy(wallMesh.position);
                    this.scene.add(line);
                }
            }
        }
        this.is3DInitialized = true;
    }

    get3DGridCoords(clientX, clientY) {
        if (!this.is3D || !this.threeRenderer) return null;
        
        const THREE = window.THREE;
        const rect = this.threeRenderer.domElement.getBoundingClientRect();
        
        this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        const intersectionPoint = new THREE.Vector3();
        
        if (this.raycaster.ray.intersectPlane(groundPlane, intersectionPoint)) {
            return {
                x: intersectionPoint.x,
                y: intersectionPoint.y
            };
        }
        return null;
    }

    // ----------------------------------------------------
    // 3D & 2D Tactical Map Renderer Routing
    // ----------------------------------------------------
    renderTacticalMap(map, entities, hiveTracks, selectedId, droneRadius, dragTarget) {
        if (!this.is3D) {
            // Fallback to 2D Renderer
            this.renderTacticalMap2D(map, entities, hiveTracks, selectedId, droneRadius, dragTarget);
            return;
        }

        const THREE = window.THREE;
        if (!this.is3DInitialized) {
            this.build3DWalls(map);
        }

        // Update controls
        this.controls.update();

        // 1. Manage entity meshes (insert, update, delete)
        const currentGroupIds = new Set();
        entities.forEach(ent => {
            currentGroupIds.add(ent.id);
            let group = this.entityGroups[ent.id];
            
            if (!group) {
                group = new THREE.Group();
                
                if (ent.role === 'soldier') {
                    // Main capsule
                    const bodyGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.5, 16);
                    bodyGeo.rotateX(Math.PI / 2);
                    const bodyMat = new THREE.MeshPhongMaterial({ color: 0x00e5ff, shininess: 80 });
                    const body = new THREE.Mesh(bodyGeo, bodyMat);
                    body.position.z = 0.25;
                    body.castShadow = true;
                    group.add(body);

                    // Directional helmet visor pointing forward along X
                    const visorGeo = new THREE.ConeGeometry(0.1, 0.25, 16);
                    visorGeo.rotateX(Math.PI / 2);
                    const visorMat = new THREE.MeshPhongMaterial({ color: 0xffffff });
                    const visor = new THREE.Mesh(visorGeo, visorMat);
                    visor.position.set(0.18, 0, 0.38);
                    visor.rotation.y = -Math.PI / 2;
                    group.add(visor);

                    // Translucent flat sight cone
                    const sightGeo = new THREE.RingGeometry(0.05, ent.range, 32, 1, -ent.fov/2, ent.fov);
                    const sightMat = new THREE.MeshBasicMaterial({
                        color: 0x00e5ff,
                        transparent: true,
                        opacity: 0.08,
                        side: THREE.DoubleSide
                    });
                    const sightMesh = new THREE.Mesh(sightGeo, sightMat);
                    sightMesh.position.z = 0.015;
                    group.add(sightMesh);
                    this.sightCones[ent.id] = sightMesh;

                    // Floating text label
                    const canvasText = document.createElement('canvas');
                    canvasText.width = 128;
                    canvasText.height = 32;
                    const ctxText = canvasText.getContext('2d');
                    ctxText.fillStyle = '#e3e8f0';
                    ctxText.font = 'bold 18px "Share Tech Mono", monospace';
                    ctxText.textAlign = 'center';
                    ctxText.fillText(ent.id, 64, 20);
                    const textTexture = new THREE.CanvasTexture(canvasText);
                    const textMat = new THREE.SpriteMaterial({ map: textTexture, transparent: true });
                    const textSprite = new THREE.Sprite(textMat);
                    textSprite.scale.set(1.2, 0.3, 1);
                    textSprite.position.set(0, 0, 0.75);
                    group.add(textSprite);

                } else if (ent.role === 'drone') {
                    // Center core
                    const bodyGeo = new THREE.SphereGeometry(0.15, 16, 16);
                    const bodyMat = new THREE.MeshPhongMaterial({ color: 0xffea00 });
                    const body = new THREE.Mesh(bodyGeo, bodyMat);
                    group.add(body);

                    // Rotor arms cross
                    const armGeo = new THREE.BoxGeometry(0.7, 0.05, 0.03);
                    const armMat = new THREE.MeshPhongMaterial({ color: 0x475569 });
                    const arm1 = new THREE.Mesh(armGeo, armMat);
                    const arm2 = new THREE.Mesh(armGeo, armMat);
                    arm2.rotation.z = Math.PI / 2;
                    group.add(arm1);
                    group.add(arm2);

                    // Rotor spinning blades
                    group.propellers = [];
                    const propOffsets = [
                        [0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]
                    ];
                    propOffsets.forEach(offset => {
                        const propGeo = new THREE.BoxGeometry(0.2, 0.02, 0.01);
                        const propMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
                        const prop = new THREE.Mesh(propGeo, propMat);
                        prop.position.set(offset[0], offset[1], 0.03);
                        group.add(prop);
                        group.propellers.push(prop);
                    });

                    // Circular scanning footprint
                    const footprintGeo = new THREE.RingGeometry(ent.radius - 0.04, ent.radius + 0.04, 32);
                    const footprintMat = new THREE.MeshBasicMaterial({
                        color: 0xffea00,
                        transparent: true,
                        opacity: 0.15,
                        side: THREE.DoubleSide
                    });
                    const footprintMesh = new THREE.Mesh(footprintGeo, footprintMat);
                    footprintMesh.position.z = 0.012;
                    this.scene.add(footprintMesh);
                    group.footprintMesh = footprintMesh;

                    // Floating label
                    const canvasText = document.createElement('canvas');
                    canvasText.width = 128;
                    canvasText.height = 32;
                    const ctxText = canvasText.getContext('2d');
                    ctxText.fillStyle = '#ffea00';
                    ctxText.font = 'bold 18px "Share Tech Mono", monospace';
                    ctxText.textAlign = 'center';
                    ctxText.fillText(ent.id, 64, 20);
                    const textTexture = new THREE.CanvasTexture(canvasText);
                    const textMat = new THREE.SpriteMaterial({ map: textTexture, transparent: true });
                    const textSprite = new THREE.Sprite(textMat);
                    textSprite.scale.set(1.2, 0.3, 1);
                    textSprite.position.set(0, 0, 0.5);
                    group.add(textSprite);

                } else if (ent.role === 'enemy') {
                    // Threat diamond (octahedron)
                    const geo = new THREE.OctahedronGeometry(0.22, 0);
                    const mat = new THREE.MeshPhongMaterial({ color: 0xff2a5f, shininess: 80 });
                    const mesh = new THREE.Mesh(geo, mat);
                    mesh.position.z = 0.3;
                    mesh.castShadow = true;
                    group.add(mesh);

                    // Enemy label
                    const canvasText = document.createElement('canvas');
                    canvasText.width = 128;
                    canvasText.height = 32;
                    const ctxText = canvasText.getContext('2d');
                    ctxText.fillStyle = '#ff2a5f';
                    ctxText.font = 'bold 18px "Share Tech Mono", monospace';
                    ctxText.textAlign = 'center';
                    ctxText.fillText(ent.id, 64, 20);
                    const textTexture = new THREE.CanvasTexture(canvasText);
                    const textMat = new THREE.SpriteMaterial({ map: textTexture, transparent: true });
                    const textSprite = new THREE.Sprite(textMat);
                    textSprite.scale.set(1.2, 0.3, 1);
                    textSprite.position.set(0, 0, 0.7);
                    group.add(textSprite);
                }

                this.scene.add(group);
                this.entityGroups[ent.id] = group;
            }

            // Update parameters
            const isSelected = ent.id === selectedId;
            const zTarget = ent.role === 'drone' ? 3.0 : 0.0;
            group.position.set(ent.x, ent.y, zTarget);
            group.rotation.z = ent.yaw;

            // Animate properties
            if (ent.role === 'soldier' && this.sightCones[ent.id]) {
                this.sightCones[ent.id].material.opacity = isSelected ? 0.14 : 0.05;
                this.sightCones[ent.id].material.color.setHex(isSelected ? 0xffffff : 0x00e5ff);
            } else if (ent.role === 'drone') {
                if (group.propellers) {
                    group.propellers.forEach(p => p.rotation.z += 0.5);
                }
                if (group.footprintMesh) {
                    group.footprintMesh.position.set(ent.x, ent.y, 0.012);
                }
            }
        });

        // Delete removed entities from 3D scene
        for (const id in this.entityGroups) {
            if (!currentGroupIds.has(id)) {
                const grp = this.entityGroups[id];
                if (grp.footprintMesh) this.scene.remove(grp.footprintMesh);
                this.scene.remove(grp);
                delete this.entityGroups[id];
                if (this.sightCones[id]) delete this.sightCones[id];
            }
        }

        // 2. Manage Hive Mind Target Tracks
        const currentTrackIds = new Set();
        if (hiveTracks && hiveTracks.enemies) {
            hiveTracks.enemies.forEach(track => {
                currentTrackIds.add(track.id);
                let trackGroup = this.targetTracks[track.id];

                if (!trackGroup) {
                    trackGroup = new THREE.Group();
                    
                    // Threat ring on floor
                    const ringGeo = new THREE.RingGeometry(0.35, 0.45, 16);
                    const ringMat = new THREE.MeshBasicMaterial({
                        color: 0xff2a5f,
                        transparent: true,
                        opacity: 0.6,
                        side: THREE.DoubleSide
                    });
                    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
                    ringMesh.position.z = 0.02;
                    trackGroup.add(ringMesh);

                    // Core marker
                    const markerGeo = new THREE.OctahedronGeometry(0.18, 0);
                    const markerMat = new THREE.MeshBasicMaterial({ color: 0xff2a5f, wireframe: true });
                    const markerMesh = new THREE.Mesh(markerGeo, markerMat);
                    markerMesh.position.z = 0.35;
                    trackGroup.add(markerMesh);

                    // Track ID Sprite
                    const canvasText = document.createElement('canvas');
                    canvasText.width = 128;
                    canvasText.height = 32;
                    const ctxText = canvasText.getContext('2d');
                    ctxText.fillStyle = '#ff2a5f';
                    ctxText.font = 'bold 16px "Share Tech Mono", monospace';
                    ctxText.textAlign = 'center';
                    ctxText.fillText(track.id, 64, 20);
                    const textTexture = new THREE.CanvasTexture(canvasText);
                    const textMat = new THREE.SpriteMaterial({ map: textTexture, transparent: true });
                    const textSprite = new THREE.Sprite(textMat);
                    textSprite.scale.set(1.1, 0.275, 1);
                    textSprite.position.set(0, 0, 0.7);
                    trackGroup.add(textSprite);

                    this.scene.add(trackGroup);
                    this.targetTracks[track.id] = trackGroup;
                }

                trackGroup.position.set(track.x, track.y, 0.0);
            });
        }

        // Clean stale target tracks
        for (const tid in this.targetTracks) {
            if (!currentTrackIds.has(tid)) {
                this.scene.remove(this.targetTracks[tid]);
                delete this.targetTracks[tid];
            }
        }

        // 3. Draw Uplink / Sensor Connection Lines
        this.connectionLines.forEach(line => this.scene.remove(line));
        this.connectionLines = [];

        if (hiveTracks && hiveTracks.enemies) {
            hiveTracks.enemies.forEach(track => {
                if (track.sources) {
                    track.sources.forEach(srcId => {
                        const reporter = entities.find(e => e.id === srcId);
                        if (reporter) {
                            const points = [
                                new THREE.Vector3(reporter.x, reporter.y, reporter.role === 'drone' ? 3.0 : 0.25),
                                new THREE.Vector3(track.x, track.y, 0.35)
                            ];
                            const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
                            const lineMat = new THREE.LineBasicMaterial({
                                color: 0xff2a5f,
                                transparent: true,
                                opacity: 0.3
                            });
                            const lineMesh = new THREE.Line(lineGeo, lineMat);
                            this.scene.add(lineMesh);
                            this.connectionLines.push(lineMesh);
                        }
                    });
                }
            });
        }

        // Highlight drag target
        if (dragTarget && this.entityGroups[dragTarget.id]) {
            // Draw a quick helper highlight mesh or rotation on drag
            this.entityGroups[dragTarget.id].rotation.z += 0.05;
        }

        // Render WebGL Viewport
        this.threeRenderer.render(this.scene, this.camera);
    }

    // ----------------------------------------------------
    // Original 2D Tactical Map Renderer
    // ----------------------------------------------------
    renderTacticalMap2D(map, entities, hiveTracks, selectedId, droneRadius, dragTarget) {

        // 2. Draw Grid & Walls
        for (let r = 0; r < map.rows; r++) {
            for (let c = 0; c < map.cols; c++) {
                const screen = toScreen(c, r);
                
                if (map.grid[r][c] === 1) {
                    // Wall
                    ctx.fillStyle = this.colors.wall;
                    ctx.fillRect(screen.x, screen.y, cellSize - 1, cellSize - 1);
                    
                    // Tech border on walls
                    ctx.strokeStyle = 'rgba(0, 168, 204, 0.15)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(screen.x, screen.y, cellSize - 1, cellSize - 1);
                } else {
                    // Empty grid cells
                    ctx.fillStyle = '#0e1320';
                    ctx.fillRect(screen.x, screen.y, cellSize - 1, cellSize - 1);
                    
                    ctx.strokeStyle = this.colors.gridLine;
                    ctx.strokeRect(screen.x, screen.y, cellSize - 1, cellSize - 1);
                }
            }
        }

        // 3. Draw Sight Cones (translucent) for Soldiers
        entities.forEach(ent => {
            if (ent.role === 'soldier') {
                const screen = toScreen(ent.x, ent.y);
                
                ctx.fillStyle = ent.id === selectedId ? 'rgba(0, 229, 255, 0.06)' : 'rgba(0, 229, 255, 0.03)';
                ctx.beginPath();
                ctx.moveTo(screen.x, screen.y);
                
                const startAngle = ent.yaw - ent.fov / 2;
                const endAngle = ent.yaw + ent.fov / 2;
                const screenRange = ent.range * cellSize;
                
                ctx.arc(screen.x, screen.y, screenRange, startAngle, endAngle);
                ctx.closePath();
                ctx.fill();
                
                // Outer arc border
                ctx.strokeStyle = ent.id === selectedId ? 'rgba(0, 229, 255, 0.2)' : 'rgba(0, 229, 255, 0.08)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, screenRange, startAngle, endAngle);
                ctx.stroke();
            } else if (ent.role === 'drone') {
                // Draw Drone scanning footprint
                const screen = toScreen(ent.x, ent.y);
                ctx.fillStyle = this.colors.droneGlow;
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, ent.radius * cellSize, 0, 2 * Math.PI);
                ctx.fill();
                
                ctx.strokeStyle = 'rgba(255, 234, 0, 0.3)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        });

        // 4. Draw Hive Mind Target Tracks (dotted circles)
        if (hiveTracks && hiveTracks.enemies) {
            hiveTracks.enemies.forEach(track => {
                const screen = toScreen(track.x, track.y);
                
                // Draw track lock ring
                ctx.strokeStyle = this.colors.enemy;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, cellSize * 0.6, 0, 2 * Math.PI);
                ctx.stroke();
                ctx.setLineDash([]);

                // Small crosshair index inside track
                ctx.fillStyle = this.colors.enemy;
                ctx.font = '9px "Share Tech Mono", monospace';
                ctx.fillText(track.id, screen.x + cellSize * 0.7, screen.y - cellSize * 0.3);
                
                // Draw vectors/lines to reporting entities
                if (track.sources) {
                    track.sources.forEach(srcId => {
                        const reporter = entities.find(e => e.id === srcId);
                        if (reporter) {
                            const repScreen = toScreen(reporter.x, reporter.y);
                            ctx.strokeStyle = 'rgba(255, 42, 95, 0.25)';
                            ctx.lineWidth = 1;
                            ctx.setLineDash([2, 5]);
                            ctx.beginPath();
                            ctx.moveTo(repScreen.x, repScreen.y);
                            ctx.lineTo(screen.x, screen.y);
                            ctx.stroke();
                            ctx.setLineDash([]);
                        }
                    });
                }
            });
        }

        // 5. Draw Actual Physical Entities (the "ground truth")
        entities.forEach(ent => {
            const screen = toScreen(ent.x, ent.y);
            
            if (ent.role === 'soldier') {
                const isSelected = ent.id === selectedId;
                
                // Draw selection aura
                if (isSelected) {
                    ctx.fillStyle = 'rgba(0, 229, 255, 0.15)';
                    ctx.beginPath();
                    ctx.arc(screen.x, screen.y, cellSize * 0.55, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.strokeStyle = this.colors.ally;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }

                // Core marker
                ctx.fillStyle = isSelected ? '#ffffff' : this.colors.ally;
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, cellSize * 0.3, 0, 2 * Math.PI);
                ctx.fill();
                
                // Orientation pointer
                ctx.strokeStyle = isSelected ? '#ffffff' : this.colors.ally;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(screen.x, screen.y);
                ctx.lineTo(
                    screen.x + Math.cos(ent.yaw) * (cellSize * 0.55),
                    screen.y + Math.sin(ent.yaw) * (cellSize * 0.55)
                );
                ctx.stroke();

                // Name label
                ctx.fillStyle = this.colors.text;
                ctx.font = '10px "Share Tech Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(ent.id, screen.x, screen.y - cellSize * 0.5);

            } else if (ent.role === 'drone') {
                // Quadrant drone marker
                ctx.strokeStyle = this.colors.drone;
                ctx.lineWidth = 2;
                
                // Draw cross structure
                const size = cellSize * 0.45;
                ctx.beginPath();
                ctx.moveTo(screen.x - size, screen.y);
                ctx.lineTo(screen.x + size, screen.y);
                ctx.moveTo(screen.x, screen.y - size);
                ctx.lineTo(screen.x, screen.y + size);
                ctx.stroke();

                // Rotors
                ctx.fillStyle = this.colors.drone;
                ctx.beginPath();
                ctx.arc(screen.x - size, screen.y, 3, 0, 2*Math.PI);
                ctx.arc(screen.x + size, screen.y, 3, 0, 2*Math.PI);
                ctx.arc(screen.x, screen.y - size, 3, 0, 2*Math.PI);
                ctx.arc(screen.x, screen.y + size, 3, 0, 2*Math.PI);
                ctx.fill();

                // Core circle
                ctx.fillStyle = '#0a0d14';
                ctx.strokeStyle = this.colors.drone;
                ctx.beginPath();
                ctx.arc(screen.x, screen.y, 5, 0, 2*Math.PI);
                ctx.fill();
                ctx.stroke();

                // Label
                ctx.fillStyle = this.colors.text;
                ctx.font = '10px "Share Tech Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(ent.id, screen.x, screen.y - cellSize * 0.6);

            } else if (ent.role === 'enemy') {
                const size = cellSize * 0.35;
                
                // Enemy red marker
                ctx.fillStyle = this.colors.enemy;
                ctx.beginPath();
                ctx.moveTo(screen.x, screen.y - size);
                ctx.lineTo(screen.x + size, screen.y + size * 0.6);
                ctx.lineTo(screen.x - size, screen.y + size * 0.6);
                ctx.closePath();
                ctx.fill();

                // Small red center dot
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(screen.x, screen.y + size * 0.1, 2, 0, 2 * Math.PI);
                ctx.fill();

                // Label
                ctx.fillStyle = this.colors.text;
                ctx.font = '10px "Share Tech Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(ent.id, screen.x, screen.y - cellSize * 0.5);
            }
        });

        // 6. Highlight Hover/Drag target
        if (dragTarget) {
            const screen = toScreen(dragTarget.x, dragTarget.y);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, cellSize * 0.7, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    // ----------------------------------------------------
    // 3D Raycaster Visor Renderer
    // ----------------------------------------------------
    renderVisor(observer, map, entities, hiveTracks, hudEnabled) {
        const ctx = this.vCtx;
        const width = this.visorCanvas.width;
        const height = this.visorCanvas.height;

        // 1. Draw Ceiling & Floor gradients
        const ceilingGrad = ctx.createLinearGradient(0, 0, 0, height / 2);
        ceilingGrad.addColorStop(0, '#020408');
        ceilingGrad.addColorStop(1, '#0b111e');
        ctx.fillStyle = ceilingGrad;
        ctx.fillRect(0, 0, width, height / 2);

        const floorGrad = ctx.createLinearGradient(0, height / 2, 0, height);
        floorGrad.addColorStop(0, '#04070d');
        floorGrad.addColorStop(1, '#000000');
        ctx.fillStyle = floorGrad;
        ctx.fillRect(0, height / 2, width, height / 2);

        // 2. Raycasting Loop
        const halfFov = this.fov / 2;
        const distProjPlane = (width / 2) / Math.tan(halfFov);

        for (let x = 0; x < width; x++) {
            // Calculate ray angle relative to observer yaw
            const rayAngle = observer.yaw - halfFov + (x / width) * this.fov;
            const rx = Math.cos(rayAngle);
            const ry = Math.sin(rayAngle);

            // DDA Variables
            let mapX = Math.floor(observer.x);
            let mapY = Math.floor(observer.y);

            const deltaDistX = Math.abs(1 / rx);
            const deltaDistY = Math.abs(1 / ry);

            let stepX, stepY;
            let sideDistX, sideDistY;

            if (rx < 0) {
                stepX = -1;
                sideDistX = (observer.x - mapX) * deltaDistX;
            } else {
                stepX = 1;
                sideDistX = (mapX + 1.0 - observer.x) * deltaDistX;
            }

            if (ry < 0) {
                stepY = -1;
                sideDistY = (observer.y - mapY) * deltaDistY;
            } else {
                stepY = 1;
                sideDistY = (mapY + 1.0 - observer.y) * deltaDistY;
            }

            // Perform DDA
            let hit = 0;
            let side = 0; // 0: vertical grid line, 1: horizontal
            let maxSteps = 40;

            while (hit === 0 && maxSteps > 0) {
                if (sideDistX < sideDistY) {
                    sideDistX += deltaDistX;
                    mapX += stepX;
                    side = 0;
                } else {
                    sideDistY += deltaDistY;
                    mapY += stepY;
                    side = 1;
                }
                if (map.isWall(mapX, mapY)) {
                    hit = 1;
                }
                maxSteps--;
            }

            // Distance to wall projection plane
            let perpWallDist;
            if (side === 0) {
                perpWallDist = sideDistX - deltaDistX;
            } else {
                perpWallDist = sideDistY - deltaDistY;
            }

            // Guard against divide by zero
            if (perpWallDist < 0.05) perpWallDist = 0.05;
            this.zBuffer[x] = perpWallDist; // Store in Z-buffer

            // Fish-eye correction
            const correctedDist = perpWallDist * Math.cos(rayAngle - observer.yaw);
            
            // Wall line height
            const lineHeight = Math.floor(height / correctedDist);
            const drawStart = Math.max(0, -lineHeight / 2 + height / 2);
            const drawEnd = Math.min(height - 1, lineHeight / 2 + height / 2);

            // Shading
            // Base brightness decays over distance
            const baseBrightness = Math.max(10, 160 - correctedDist * 16);
            // Shade Y-sides darker to create 3D depth cornering
            const sideFactor = side === 1 ? 0.6 : 1.0;
            const brightness = Math.floor(baseBrightness * sideFactor);
            
            // Tech cyan wall coloring
            ctx.fillStyle = `rgb(0, ${Math.floor(brightness * 0.6)}, ${brightness})`;
            ctx.fillRect(x, drawStart, 1, drawEnd - drawStart);

            // Digital Grid Overlay on walls
            // Check fraction of intersection coordinate to draw vertical panel lines
            let intersectCoord;
            if (side === 0) {
                intersectCoord = observer.y + perpWallDist * ry;
            } else {
                intersectCoord = observer.x + perpWallDist * rx;
            }
            const fraction = intersectCoord % 1.0;
            if (fraction < 0.03 || fraction > 0.97) {
                ctx.fillStyle = `rgba(0, 229, 255, ${Math.max(0.05, 0.4 - correctedDist * 0.03)})`;
                ctx.fillRect(x, drawStart, 1, drawEnd - drawStart);
            }
        }

        // 3. Project Physical Entities (Sprites)
        // Compile list of other entities that physically exist in the world
        const visibleSprites = [];

        entities.forEach(ent => {
            if (ent.id === observer.id) return;
            if (ent.role === 'drone') return; // Drone is overhead, not visible in first-person headset camera

            const dx = ent.x - observer.x;
            const dy = ent.y - observer.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            // Angle to entity
            const angleToSprite = Math.atan2(dy, dx);
            let relAngle = MathUtils.normalizeAngle(angleToSprite - observer.yaw);

            // Check if inside screen limits
            if (Math.abs(relAngle) < halfFov + 0.4) {
                const screenX = Math.floor(width / 2 + Math.tan(relAngle) * distProjPlane);
                const spriteSize = Math.floor(height / dist * 0.7);
                visibleSprites.push({
                    ent: ent,
                    screenX: screenX,
                    size: spriteSize,
                    dist: dist
                });
            }
        });

        // Sort sprites by distance (furthest first) for correct layering
        visibleSprites.sort((a, b) => b.dist - a.dist);

        // Draw physical sprites
        visibleSprites.forEach(sprite => {
            const { ent, screenX, size, dist } = sprite;
            const xLeft = Math.floor(screenX - size / 2);
            
            // Check occlusion against Z-buffer
            // If sprite center is behind the wall, it is physically blocked
            const zCol = Math.floor(screenX);
            const isOccluded = zCol < 0 || zCol >= width || dist > this.zBuffer[zCol];

            if (!isOccluded) {
                const yTop = Math.floor(height / 2 - size / 2);
                
                // Draw physical representation (Vector Graphic Billboard)
                this.drawEntityBillboard(ctx, ent, xLeft, yTop, size);

                // Draw Direct HUD Target lock
                if (hudEnabled) {
                    this.drawHUDElements(ctx, ent.id, ent.role, xLeft, yTop, size, dist, false);
                }
            }
        });

        // 4. Project Occluded / AR Overlays from Hive Mind
        // This takes coordinates from the Hive Mind tracks and projects them!
        if (hudEnabled && hiveTracks) {
            // Fuse allies and enemies from hive tracks
            const tracksToDraw = [];

            // Add allies in the Hive Mind (excluding self)
            if (hiveTracks.allies) {
                hiveTracks.allies.forEach(ally => {
                    if (ally.id === observer.id) return;
                    tracksToDraw.push({
                        id: ally.id,
                        role: 'soldier',
                        x: ally.x,
                        y: ally.y
                    });
                });
            }

            // Add enemies in the Hive Mind
            if (hiveTracks.enemies) {
                hiveTracks.enemies.forEach(enemy => {
                    tracksToDraw.push({
                        id: enemy.id,
                        role: 'enemy',
                        x: enemy.x,
                        y: enemy.y
                    });
                });
            }

            tracksToDraw.forEach(track => {
                const dx = track.x - observer.x;
                const dy = track.y - observer.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist < 0.1) return;

                const angleToTrack = Math.atan2(dy, dx);
                const relAngle = MathUtils.normalizeAngle(angleToTrack - observer.yaw);

                // Is it in the screen's field of view?
                if (Math.abs(relAngle) < halfFov + 0.4) {
                    const screenX = Math.floor(width / 2 + Math.tan(relAngle) * distProjPlane);
                    const size = Math.floor(height / dist * 0.7);
                    const xLeft = Math.floor(screenX - size / 2);
                    const yTop = Math.floor(height / 2 - size / 2);
                    
                    const zCol = Math.floor(screenX);
                    const isOccluded = zCol < 0 || zCol >= width || dist > this.zBuffer[zCol];

                    // If it is occluded, draw the AR X-Ray Target bounding box!
                    if (isOccluded) {
                        this.drawHUDElements(ctx, track.id, track.role, xLeft, yTop, size, dist, true);
                    }
                }
            });
        }

        // 5. Draw static Headset HUD overlay (reticle, status info)
        this.drawStaticHUDOverlay(ctx, observer, hudEnabled);
    }

    // Draw stylized billboard avatar for physically visible entities
    drawEntityBillboard(ctx, ent, x, y, size) {
        ctx.save();
        
        // Draw glow aura
        const isEnemy = ent.role === 'enemy';
        const coreColor = isEnemy ? this.colors.enemy : this.colors.ally;
        
        // Silhouette shape
        ctx.fillStyle = coreColor;
        ctx.shadowColor = coreColor;
        ctx.shadowBlur = 10;

        // Draw tactical marker avatar
        ctx.beginPath();
        // Head
        ctx.arc(x + size / 2, y + size * 0.25, size * 0.12, 0, 2*Math.PI);
        // Body / torso
        ctx.moveTo(x + size / 2, y + size * 0.37);
        ctx.lineTo(x + size * 0.3, y + size * 0.8);
        ctx.lineTo(x + size * 0.7, y + size * 0.8);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    // Draw target bounding boxes, indicators, and telemetry text
    drawHUDElements(ctx, id, role, x, y, size, dist, isOccluded) {
        ctx.save();
        
        const isEnemy = role === 'enemy';
        const primaryColor = isEnemy ? this.colors.enemy : this.colors.ally;
        const fontColor = isOccluded ? 'rgba(255,255,255,0.7)' : '#ffffff';
        
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = isOccluded ? 1 : 2;
        
        if (isOccluded) {
            // Translucent x-ray box
            ctx.fillStyle = isEnemy ? 'rgba(255, 42, 95, 0.05)' : 'rgba(0, 229, 255, 0.05)';
            ctx.fillRect(x, y, size, size);
            // Dashed border
            ctx.setLineDash([3, 3]);
        }

        // Draw Corner brackets (bracket-style targeting reticle)
        const bSize = Math.max(4, size * 0.2); // Bracket length
        
        // Top Left
        ctx.beginPath();
        ctx.moveTo(x + bSize, y); ctx.lineTo(x, y); ctx.lineTo(x, y + bSize);
        ctx.stroke();

        // Top Right
        ctx.beginPath();
        ctx.moveTo(x + size - bSize, y); ctx.lineTo(x + size, y); ctx.lineTo(x + size, y + bSize);
        ctx.stroke();

        // Bottom Left
        ctx.beginPath();
        ctx.moveTo(x, y + size - bSize); ctx.lineTo(x, y + size); ctx.lineTo(x + bSize, y + size);
        ctx.stroke();

        // Bottom Right
        ctx.beginPath();
        ctx.moveTo(x + size - bSize, y + size); ctx.lineTo(x + size, y + size); ctx.lineTo(x + size, y + size - bSize);
        ctx.stroke();
        
        ctx.setLineDash([]); // Reset line dash

        // Draw label & distance info
        ctx.fillStyle = primaryColor;
        ctx.font = '8px "Share Tech Mono", monospace';
        ctx.textAlign = 'left';
        
        const sourceLabel = isOccluded ? `[HIVE LINK // BLOCKED]` : `[DIRECT // SECURED]`;
        ctx.fillText(sourceLabel, x, y - 14);

        ctx.fillStyle = fontColor;
        ctx.font = 'bold 9px "Share Tech Mono", monospace';
        ctx.fillText(`${id.toUpperCase()} // DIST: ${dist.toFixed(1)}m`, x, y - 4);

        // If occluded, draw warning markers
        if (isOccluded && isEnemy) {
            ctx.fillStyle = this.colors.enemy;
            ctx.font = 'bold 8px "Share Tech Mono", monospace';
            ctx.fillText(`!WALL PENETRATING LOCK!`, x, y + size + 10);
        }

        ctx.restore();
    }

    // Draw static headset HUD (Reticle, telemetry, scanlines)
    drawStaticHUDOverlay(ctx, observer, hudEnabled) {
        const width = this.visorCanvas.width;
        const height = this.visorCanvas.height;

        // Draw Scanlines overlay
        ctx.fillStyle = 'rgba(0, 255, 102, 0.015)';
        for (let i = 0; i < height; i += 3) {
            ctx.fillRect(0, i, width, 1);
        }

        if (!hudEnabled) {
            // Normal vision display (no HUD overlays)
            // Just draw selected agent label in corner
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '10px "Share Tech Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`VISOR FEED: ${observer.id.toUpperCase()}`, 15, 25);
            ctx.fillText(`HUD LINK: STANDBY`, 15, 38);
            return;
        }

        ctx.save();
        
        // 1. Draw Central Targeting Reticle
        ctx.strokeStyle = this.colors.hudGreenDim;
        ctx.lineWidth = 1;
        
        // Outer ring
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, 40, 0, 2 * Math.PI);
        ctx.stroke();

        // Inner micro-reticle
        ctx.strokeStyle = this.colors.hudGreen;
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, 4, 0, 2 * Math.PI);
        ctx.stroke();

        // Crosshair ticks
        ctx.beginPath();
        ctx.moveTo(width / 2 - 15, height / 2); ctx.lineTo(width / 2 - 8, height / 2);
        ctx.moveTo(width / 2 + 8, height / 2); ctx.lineTo(width / 2 + 15, height / 2);
        ctx.moveTo(width / 2, height / 2 - 15); ctx.lineTo(width / 2, height / 2 - 8);
        ctx.moveTo(width / 2, height / 2 + 8); ctx.lineTo(width / 2, height / 2 + 15);
        ctx.stroke();

        // 2. Telemetry and visor details
        ctx.fillStyle = this.colors.hudGreen;
        ctx.font = '10px "Share Tech Mono", monospace';
        
        // Top Left Information
        ctx.textAlign = 'left';
        ctx.fillText(`OPERATOR: ${observer.id.toUpperCase()}`, 15, 25);
        ctx.fillText(`COORDS: X ${observer.x.toFixed(2)} / Y ${observer.y.toFixed(2)}`, 15, 38);
        ctx.fillText(`HEADING: ${(observer.yaw * (180 / Math.PI)).toFixed(0)}°`, 15, 51);

        // Top Right Information
        ctx.textAlign = 'right';
        ctx.fillText(`HIVE LINK: ACTIVE`, width - 15, 25);
        ctx.fillText(`FREQ: 5.8 GHz`, width - 15, 38);
        ctx.fillStyle = this.colors.hudGreen;
        ctx.fillText(`SYS CONF: 100%`, width - 15, 51);

        // Bottom display bounds
        ctx.strokeStyle = this.colors.hudGreenDim;
        ctx.beginPath();
        ctx.moveTo(15, height - 30);
        ctx.lineTo(30, height - 30);
        ctx.moveTo(15, height - 30);
        ctx.lineTo(15, height - 15);
        
        ctx.moveTo(width - 15, height - 30);
        ctx.lineTo(width - 30, height - 30);
        ctx.moveTo(width - 15, height - 30);
        ctx.lineTo(width - 15, height - 15);
        ctx.stroke();

        // Compass ribbon at top center
        const compassCenter = width / 2;
        ctx.fillStyle = 'rgba(0, 255, 102, 0.1)';
        ctx.fillRect(compassCenter - 80, 5, 160, 16);
        ctx.strokeStyle = this.colors.hudGreenDim;
        ctx.strokeRect(compassCenter - 80, 5, 160, 16);

        ctx.fillStyle = this.colors.hudGreen;
        ctx.font = '9px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';

        const deg = Math.floor(observer.yaw * (180 / Math.PI)) + 90; // offset so North is up
        const directions = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
        const dirIndex = Math.floor(((observer.yaw + Math.PI / 8 + Math.PI*2) % (Math.PI * 2)) / (Math.PI / 4));
        ctx.fillText(`${directions[dirIndex]} | ${deg % 360}°`, compassCenter, 17);

        ctx.restore();
    }
}

window.TacticalRenderer = TacticalRenderer;
