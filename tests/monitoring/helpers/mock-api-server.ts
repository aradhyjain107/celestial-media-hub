import http from 'http';
import { URL } from 'url';

export interface InterceptConfig {
  status?: number;
  delay?: number;
  body?: string | object;
}

export class MockApiServer {
  private server: http.Server | null = null;
  private intercepts: Map<string, InterceptConfig> = new Map();
  private targetPort: number = 3000;

  constructor(targetPort: number = 3000) {
    this.targetPort = targetPort;
  }

  setIntercept(path: string, config: InterceptConfig) {
    this.intercepts.set(path, config);
  }

  clearIntercepts() {
    this.intercepts.clear();
  }

  start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        const parsedUrl = new URL(req.url || '', `http://${req.headers.host}`);
        const pathname = parsedUrl.pathname;

        // Check if this path is intercepted
        if (this.intercepts.has(pathname)) {
          const config = this.intercepts.get(pathname)!;
          const handleIntercept = () => {
            res.writeHead(config.status || 500, { 'Content-Type': 'application/json' });
            const bodyStr = typeof config.body === 'object' ? JSON.stringify(config.body) : (config.body || '{"error":"Mocked error"}');
            res.end(bodyStr);
          };

          if (config.delay) {
            setTimeout(handleIntercept, config.delay);
          } else {
            handleIntercept();
          }
          return;
        }

        // Proxy to targetPort
        const targetOptions: http.RequestOptions = {
          hostname: 'localhost',
          port: this.targetPort,
          path: req.url,
          method: req.method,
          headers: req.headers,
        };

        const proxyReq = http.request(targetOptions, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          proxyRes.pipe(res, { end: true });
        });

        proxyReq.on('error', (err) => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Proxy failed', details: err.message }));
        });

        req.pipe(proxyReq, { end: true });
      });

      this.server.listen(port, () => {
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        if (typeof this.server.closeAllConnections === 'function') {
          this.server.closeAllConnections();
        }
        this.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
        this.server = null;
      } else {
        resolve();
      }
    });
  }
}
