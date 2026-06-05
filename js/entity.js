// Tactical Simulation Entities

class BaseEntity {
    constructor(id, role, x, y, yaw, color) {
        this.id = id;
        this.role = role; // 'soldier', 'drone', 'enemy'
        this.x = x;
        this.y = y;
        this.yaw = yaw; // angle in radians
        this.color = color;
        this.detections = [];
    }

    update(dt, map) {
        // Implemented by subclasses
    }
}

class Soldier extends BaseEntity {
    constructor(id, x, y, yaw, color) {
        super(id, 'soldier', x, y, yaw, color);
        this.speed = 1.8; // Grid units per second
        this.rotSpeed = 2.0; // Radians per second
        
        // Sensory specs
        this.fov = Math.PI / 3; // 60 degrees field of view
        this.range = 7.5;       // Sight range in grid units
        
        // Navigation / Patrol state
        this.autoPatrol = true;
        this.patrolPoints = [];
        this.currentPatrolIdx = 0;
        this.stuckTimer = 0;
    }

    update(dt, map, keyboardState, isSelected) {
        if (isSelected && !this.autoPatrol) {
            // Manual control
            let moveDir = 0;
            if (keyboardState['w'] || keyboardState['ArrowUp']) moveDir = 1;
            if (keyboardState['s'] || keyboardState['ArrowDown']) moveDir = -1;

            let rotDir = 0;
            if (keyboardState['a'] || keyboardState['ArrowLeft']) rotDir = -1;
            if (keyboardState['d'] || keyboardState['ArrowRight']) rotDir = 1;

            // Update heading
            this.yaw += rotDir * this.rotSpeed * dt;
            this.yaw = MathUtils.normalizeAngle(this.yaw);

            // Move and collide
            if (moveDir !== 0) {
                const dx = Math.cos(this.yaw) * this.speed * moveDir * dt;
                const dy = Math.sin(this.yaw) * this.speed * moveDir * dt;
                this.moveWithCollision(dx, dy, map);
            }
        } else if (this.autoPatrol) {
            // Automatic patrolling logic
            if (this.patrolPoints.length === 0) {
                this.generateNewPatrolRoute(map);
            }

            const target = this.patrolPoints[this.currentPatrolIdx];
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 0.2) {
                // Next patrol node
                this.currentPatrolIdx = (this.currentPatrolIdx + 1) % this.patrolPoints.length;
                if (this.currentPatrolIdx === 0) {
                    this.generateNewPatrolRoute(map);
                }
            } else {
                // Steer towards target
                const targetAngle = Math.atan2(dy, dx);
                let angleDiff = MathUtils.normalizeAngle(targetAngle - this.yaw);

                // Rotate towards target
                const stepRot = this.rotSpeed * dt;
                if (Math.abs(angleDiff) < stepRot) {
                    this.yaw = targetAngle;
                } else {
                    this.yaw += Math.sign(angleDiff) * stepRot;
                }

                // Move forward
                const forwardX = Math.cos(this.yaw) * this.speed * dt;
                const forwardY = Math.sin(this.yaw) * this.speed * dt;
                
                const oldX = this.x;
                const oldY = this.y;
                this.moveWithCollision(forwardX, forwardY, map);

                // If not moving (stuck against wall), generate a new route
                if (MathUtils.distance(oldX, oldY, this.x, this.y) < 0.05 * this.speed * dt) {
                    this.stuckTimer += dt;
                    if (this.stuckTimer > 0.5) {
                        this.generateNewPatrolRoute(map);
                        this.stuckTimer = 0;
                    }
                } else {
                    this.stuckTimer = 0;
                }
            }
        }
    }

    moveWithCollision(dx, dy, map) {
        // Slide along walls
        const radius = 0.25; // collision radius of soldier
        
        // Try X movement
        const newX = this.x + dx;
        if (!this.checkWallCollision(newX, this.y, radius, map)) {
            this.x = newX;
        }
        
        // Try Y movement
        const newY = this.y + dy;
        if (!this.checkWallCollision(this.x, newY, radius, map)) {
            this.y = newY;
        }
    }

    checkWallCollision(px, py, radius, map) {
        // Check surrounding grid cells
        const minX = Math.floor(px - radius);
        const maxX = Math.floor(px + radius);
        const minY = Math.floor(py - radius);
        const maxY = Math.floor(py + radius);

        for (let gx = minX; gx <= maxX; gx++) {
            for (let gy = minY; gy <= maxY; gy++) {
                if (map.isWall(gx, gy)) {
                    // Check intersection with this grid block
                    const closestX = Math.max(gx, Math.min(px, gx + 1));
                    const closestY = Math.max(gy, Math.min(py, gy + 1));
                    const distX = px - closestX;
                    const distY = py - closestY;
                    const dist = Math.sqrt(distX * distX + distY * distY);
                    if (dist < radius) return true;
                }
            }
        }
        return false;
    }

    generateNewPatrolRoute(map) {
        this.patrolPoints = [];
        let curX = Math.floor(this.x);
        let curY = Math.floor(this.y);
        
        // Generate a random path of empty adjacent cells
        for (let i = 0; i < 4; i++) {
            const dirs = [
                {x: 1, y: 0}, {x: -1, y: 0},
                {x: 0, y: 1}, {x: 0, y: -1}
            ];
            // Filter open directions
            const openDirs = dirs.filter(d => !map.isWall(curX + d.x, curY + d.y));
            if (openDirs.length > 0) {
                const choice = openDirs[Math.floor(Math.random() * openDirs.length)];
                curX += choice.x;
                curY += choice.y;
                this.patrolPoints.push({x: curX + 0.5, y: curY + 0.5});
            } else {
                break;
            }
        }

        if (this.patrolPoints.length === 0) {
            // Just walk to a random spot on the map
            const rnd = map.getRandomEmptyPosition();
            this.patrolPoints.push(rnd);
        }
        this.currentPatrolIdx = 0;
    }

    performSensorSweep(allEntities, map) {
        this.detections = [];

        for (const ent of allEntities) {
            if (ent.id === this.id) continue;
            
            // Calculate distance and relative angle
            const rel = MathUtils.globalToRelative(this.x, this.y, this.yaw, ent.x, ent.y);
            
            // Check range and FOV cone
            if (rel.dist <= this.range && Math.abs(rel.bearing) <= this.fov / 2) {
                // Check Line of Sight against walls
                if (MathUtils.checkLineOfSight(this.x, this.y, ent.x, ent.y, map)) {
                    this.detections.push({
                        type: ent.role,
                        id: ent.id,
                        rel_dist: rel.dist,
                        rel_bearing: rel.bearing
                    });
                }
            }
        }
        return this.detections;
    }

    getTelemetry() {
        return {
            id: this.id,
            role: 'soldier',
            x: this.x,
            y: this.y,
            yaw: this.yaw,
            detections: this.detections
        };
    }
}

class Drone extends BaseEntity {
    constructor(id, x, y, color) {
        super(id, 'drone', x, y, 0, color);
        this.speed = 1.0;
        this.radius = 4.5; // Circular top-down scanning footprint
        this.patrolRadius = 3.0;
        this.centerX = x;
        this.centerY = y;
        this.angle = 0;
    }

    update(dt, map) {
        // Drones orbit in a slow circle overhead
        this.angle += this.speed * 0.15 * dt;
        this.x = this.centerX + Math.cos(this.angle) * this.patrolRadius;
        this.y = this.centerY + Math.sin(this.angle) * this.patrolRadius;
        // Face forward along trajectory
        this.yaw = this.angle + Math.PI / 2;
    }

    performSensorSweep(allEntities, map) {
        this.detections = [];

        for (const ent of allEntities) {
            if (ent.id === this.id) continue;
            if (ent.role === 'drone') continue; // drone doesn't track other drones

            // Overhead check (distance on 2D plane)
            const dx = ent.x - this.x;
            const dy = ent.y - this.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist <= this.radius) {
                // Since the drone is overhead, it can see everything in streets and courtyards.
                // We'll calculate bearing relative to its yaw and report.
                const rel = MathUtils.globalToRelative(this.x, this.y, this.yaw, ent.x, ent.y);
                this.detections.push({
                    type: ent.role,
                    id: ent.id,
                    rel_dist: rel.dist,
                    rel_bearing: rel.bearing
                });
            }
        }
        return this.detections;
    }

    getTelemetry() {
        return {
            id: this.id,
            role: 'drone',
            x: this.x,
            y: this.y,
            yaw: this.yaw,
            detections: this.detections
        };
    }
}

class Enemy extends BaseEntity {
    constructor(id, x, y, color) {
        super(id, 'enemy', x, y, 0, color);
        this.speed = 0.5;
        this.isWandering = false;
        this.targetPoint = null;
    }

    update(dt, map) {
        if (!this.isWandering) return;

        if (!this.targetPoint) {
            this.targetPoint = map.getRandomEmptyPosition();
        }

        const dx = this.targetPoint.x - this.x;
        const dy = this.targetPoint.y - this.y;
        const dist = Math.sqrt(dx*dx + dy*dy);

        if (dist < 0.2) {
            this.targetPoint = map.getRandomEmptyPosition();
        } else {
            this.yaw = Math.atan2(dy, dx);
            const step = this.speed * dt;
            this.x += Math.cos(this.yaw) * step;
            this.y += Math.sin(this.yaw) * step;
        }
    }
}

window.Soldier = Soldier;
window.Drone = Drone;
window.Enemy = Enemy;
