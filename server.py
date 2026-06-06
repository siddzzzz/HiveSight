import os
import json
import math
import time
from http.server import SimpleHTTPRequestHandler, HTTPServer

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class HiveMind:
    def __init__(self):
        self.allies = {}       # id -> {id, type, x, y, yaw, last_seen}
        self.enemies = {}      # track_id -> {id, type, x, y, last_seen, sources}
        self.next_track_idx = 1

    def report_self(self, entity_id, role, x, y, yaw):
        if role == 'soldier' or role == 'drone':
            self.allies[entity_id] = {
                'id': entity_id,
                'type': role,
                'x': x,
                'y': y,
                'yaw': yaw,
                'last_seen': time.time()
            }

    def report_visual(self, reporter_id, reporter_x, reporter_y, reporter_yaw, detections):
        now = time.time()
        for det in detections:
            det_type = det.get('type')
            rel_dist = float(det.get('rel_dist', 0.0))
            rel_bearing = float(det.get('rel_bearing', 0.0))

            # Transform relative coords to estimated global coordinates
            global_angle = reporter_yaw + rel_bearing
            est_x = reporter_x + rel_dist * math.cos(global_angle)
            est_y = reporter_y + rel_dist * math.sin(global_angle)

            if det_type == 'enemy':
                fused = False
                # Try to fuse with existing tracks based on proximity
                for track_id, track in self.enemies.items():
                    dx = track['x'] - est_x
                    dy = track['y'] - est_y
                    dist = math.sqrt(dx*dx + dy*dy)
                    
                    # If within 1.2 grid units, cluster it
                    if dist < 1.2:
                        # Smooth/filter position estimate: moving average update
                        track['x'] = track['x'] * 0.7 + est_x * 0.3
                        track['y'] = track['y'] * 0.7 + est_y * 0.3
                        track['last_seen'] = now
                        if reporter_id not in track['sources']:
                            track['sources'].append(reporter_id)
                        fused = True
                        break
                
                if not fused:
                    # Spawn new track
                    track_id = f"TRK-{self.next_track_idx:02d}"
                    self.next_track_idx += 1
                    self.enemies[track_id] = {
                        'id': track_id,
                        'type': 'enemy',
                        'x': est_x,
                        'y': est_y,
                        'last_seen': now,
                        'sources': [reporter_id]
                    }

    def get_tracks(self):
        now = time.time()
        # Remove enemy tracks not spotted for 3.0 seconds
        stale_enemies = [tid for tid, t in self.enemies.items() if now - t['last_seen'] > 3.0]
        for tid in stale_enemies:
            del self.enemies[tid]

        # Remove allies that haven't sent telemetry for 5.0 seconds
        stale_allies = [aid for aid, a in self.allies.items() if now - a['last_seen'] > 5.0]
        for aid in stale_allies:
            del self.allies[aid]

        return {
            'allies': list(self.allies.values()),
            'enemies': list(self.enemies.values())
        }

    def reset(self):
        self.allies.clear()
        self.enemies.clear()
        self.next_track_idx = 1


hive_mind = HiveMind()

class HiveSightHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Enable CORS for local debugging if needed
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_POST(self):
        if self.path == '/api/report':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                entity_id = data.get('id')
                role = data.get('role', 'soldier')
                x = float(data.get('x', 0))
                y = float(data.get('y', 0))
                yaw = float(data.get('yaw', 0))
                
                hive_mind.report_self(entity_id, role, x, y, yaw)
                
                detections = data.get('detections', [])
                if detections:
                    hive_mind.report_visual(entity_id, x, y, yaw, detections)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success'}).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
        elif self.path == '/api/reset':
            hive_mind.reset()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'reset'}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == '/api/tracks':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
            self.end_headers()
            self.wfile.write(json.dumps(hive_mind.get_tracks()).encode('utf-8'))
        else:
            super().do_GET()

def run_server():
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, HiveSightHandler)
    print(f"HiveSight Fusion Server started on port {PORT}...")
    print(f"Serving files from: {DIRECTORY}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Server...")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
