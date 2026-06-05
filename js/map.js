// Tactical Map Grid Definition

class TacticalMap {
    constructor() {
        // 16x16 Tactical Grid
        // 1: Wall, 0: Empty Space
        this.grid = [
            [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
            [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
            [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1],
            [1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1],
            [1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1],
            [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
            [1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1],
            [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
            [1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1],
            [1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1],
            [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1],
            [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1],
            [1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1],
            [1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
        ];
        
        this.rows = this.grid.length;
        this.cols = this.grid[0].length;
    }

    // Check if grid coordinate is a wall
    isWall(gx, gy) {
        if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) {
            return true; // Out of bounds is treated as a wall
        }
        return this.grid[gy][gx] === 1;
    }

    // Get wall value
    getWall(gx, gy) {
        if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) {
            return 1;
        }
        return this.grid[gy][gx];
    }

    // Find a random empty position on the grid
    getRandomEmptyPosition() {
        let attempts = 0;
        while (attempts < 100) {
            const gx = Math.floor(Math.random() * (this.cols - 2)) + 1;
            const gy = Math.floor(Math.random() * (this.rows - 2)) + 1;
            if (this.grid[gy][gx] === 0) {
                // Return coordinate at the center of the grid cell
                return {
                    x: gx + 0.5,
                    y: gy + 0.5
                };
            }
            attempts++;
        }
        return { x: 1.5, y: 1.5 }; // Fallback
    }
}

window.TacticalMap = TacticalMap;
