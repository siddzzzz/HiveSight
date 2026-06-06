// Tactical Math Utilities

const MathUtils = {
    // Normalize an angle to be between -PI and PI
    normalizeAngle(angle) {
        while (angle < -Math.PI) angle += 2 * Math.PI;
        while (angle > Math.PI) angle -= 2 * Math.PI;
        return angle;
    },

    // Distance between two points
    distance(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        return Math.sqrt(dx * dx + dy * dy);
    },

    // Check line-of-sight between two points on the map
    // Returns true if there is a clear line of sight, false if blocked by a wall
    checkLineOfSight(x1, y1, x2, y2, map) {
        const steps = Math.ceil(this.distance(x1, y1, x2, y2) * 10);
        if (steps === 0) return true;

        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const px = x1 + (x2 - x1) * t;
            const py = y1 + (y2 - y1) * t;
            
            // Convert to grid coordinates
            const gx = Math.floor(px);
            const gy = Math.floor(py);

            if (map.isWall(gx, gy)) {
                return false; // Path is blocked by a wall
            }
        }
        return true;
    },

    // Convert global coordinates to relative polar coordinates (range and bearing)
    globalToRelative(observerX, observerY, observerYaw, targetX, targetY) {
        const dx = targetX - observerX;
        const dy = targetY - observerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Absolute angle to target
        const absAngle = Math.atan2(dy, dx);
        
        // Relative bearing compared to observer heading
        const relBearing = this.normalizeAngle(absAngle - observerYaw);
        
        return {
            dist: dist,
            bearing: relBearing
        };
    },

    // Convert relative polar coordinates back to global coordinates
    relativeToGlobal(observerX, observerY, observerYaw, relDist, relBearing) {
        const absAngle = observerYaw + relBearing;
        return {
            x: observerX + relDist * Math.cos(absAngle),
            y: observerY + relDist * Math.sin(absAngle)
        };
    }
};
window.MathUtils = MathUtils;
