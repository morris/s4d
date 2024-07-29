import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import mime from 'mime';
import * as path from 'path';
import WebSocket, { WebSocketServer } from 'ws';

export interface DevServerOptions {
  webroot: string;
  port: number;
  host?: string;
  spa?: boolean;
}

interface FileCacheEntry {
  contents: string | Buffer;
  contentType: string;
  version: string;
}

export class DevServer {
  protected webroot: string;
  protected port: number;
  protected host?: string;
  protected spa?: boolean;

  protected server: http.Server;
  protected webSocketServer: WebSocketServer;
  protected fileWatcher?: fs.FSWatcher;

  protected fileCache = new Map<string, Promise<FileCacheEntry>>();
  protected webSockets = new Set<WebSocket>();

  constructor(options: DevServerOptions) {
    this.webroot = options.webroot;
    this.port = options.port;
    this.host = options.host;
    this.spa = options.spa;

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.webSocketServer = new WebSocketServer({ server: this.server });
    this.webSocketServer.on('connection', (webSocket) =>
      this.webSockets.add(webSocket),
    );
  }

  static async cli(argv: string[]) {
    for (let i = 0; i < argv.length; ++i) {
      switch (argv[i]) {
        case '-h':
        case '--help':
          console.log(this.help());

          return;
      }
    }

    let webroot: string | undefined;
    let port = 8080;
    let host = 'localhost';
    let spa = false;

    try {
      for (let i = 0; i < argv.length; ++i) {
        switch (argv[i]) {
          case '--port':
            if (i + 1 >= argv.length) {
              throw new Error('--port requires an argument');
            }

            port = parseInt(argv[++i], 10);

            if (!(port >= 0 && port <= 65535)) {
              throw new Error(`Invalid port "${port}"`);
            }
            break;
          case '--host':
            if (i + 1 >= argv.length) {
              throw new Error('--host requires an argument');
            }

            host = argv[++i];
          case '--spa':
            spa = true;
            break;
          default:
            if (webroot) {
              throw new Error(`Unexpected argument "${argv[i]}"`);
            }

            webroot = argv[i];
        }
      }

      if (!webroot) {
        throw new Error('Webroot is required');
      }
    } catch (err) {
      console.error(`Error: ${(err as Error).message}\n`);
      console.error(this.help());

      return 1;
    }

    const devServer = new DevServer({ webroot, port, host, spa });

    await devServer.start();

    console.error(`Development server started: ${devServer.getBaseURL()}`);
  }

  static help() {
    return `s4d [options] <webroot>

  --help, -h      Show this help.
  --host <host>   Set hostname. Default is "localhost".
                  Set "0.0.0.0" to expose over network.
  --port <port>   Set port. Default is 8080.
  --spa           Single-page application mode.
                  Serves /index.html for URLs that cannot be resolved to a file.

`;
  }

  async start() {
    try {
      await this.startWatching();
      await this.startServer();
    } catch (err) {
      await this.close();

      throw err;
    }
  }

  async startServer() {
    return new Promise<void>((resolve, reject) => {
      this.server.on('listening', () => {
        const address = this.server.address();

        if (address && typeof address !== 'string') {
          this.port = address.port;
          resolve();
        } else {
          throw new Error(`Unexpected server address: ${address}`);
        }
      });

      this.server.on('error', reject);

      this.server.listen(this.port, this.host);
    });
  }

  getBaseURL() {
    const hostname =
      !this.host || this.host === '0.0.0.0' ? 'localhost' : this.host;

    return `http://${hostname}:${this.port}`;
  }

  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('content-type', 'text/plain');
      res.writeHead(405);
      res.end('Method not allowed');

      return;
    }

    const url = new URL(req.url ?? '/', this.getBaseURL());

    try {
      const file = path.join(this.webroot, path.resolve('.', url.pathname));
      const { contents, contentType, version } = await this.resolveFileCached(
        file,
      ).catch((err) => {
        if (this.spa && (err as { code?: string }).code === 'ENOENT') {
          return this.resolveFileCached(path.join(this.webroot, 'index.html'));
        }

        throw err;
      });

      if (req.headers['if-none-match'] === version) {
        res.writeHead(304);
        res.end();

        return;
      }

      res.setHeader('content-type', contentType);
      res.setHeader('etag', version);
      res.writeHead(200);

      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(contents);
      }
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') {
        res.setHeader('content-type', 'text/plain');
        res.writeHead(404);
        res.end('Not found');
      } else {
        console.error(err);

        res.setHeader('content-type', 'text/plain');
        res.writeHead(500);
        res.end(`Internal server error: ${(err as Error).message}`);
      }
    }
  }

  async startWatching() {
    this.fileWatcher = fs.watch(this.webroot, { recursive: true });

    this.fileWatcher.on('change', (_, filename) => {
      if (typeof filename === 'string') {
        this.invalidateFile(path.join(this.webroot, filename));
        this.broadcast({ type: 'change', url: filename });
      }
    });
  }

  broadcast(message: Record<string, unknown>) {
    for (const webSocket of this.webSockets) {
      if (webSocket.readyState === WebSocket.OPEN) {
        webSocket.send(JSON.stringify(message));
      } else {
        this.webSockets.delete(webSocket);
        webSocket.terminate();
      }
    }
  }

  async transformFileContents(file: string, contents: string | Buffer) {
    const ext = path.extname(file);

    if (ext === '.html') {
      return `${contents}<script type="module" src="__DEV__.js"></script>`;
    }

    return contents;
  }

  getClientScript() {
    return `if (!navigator.webdriver) {
      const wsProtocol = location.protocol === 'http:' ? 'ws://' : 'wss://';
      const socket = new WebSocket(wsProtocol + location.host);

      const hotURLs = new Set();

      socket.addEventListener('message', (message) => {
        if (!message.data) return;

        const data = JSON.parse(message.data);

        if (hotURLs.has(data.url)) {
          return;
        }

        if (hotURLs.size === 0) {
          setTimeout(() => hotURLs.clear(), 50);
        }

        hotURLs.add(data.url);

        let reload = true;

        // Hot reload stylesheets
        document.querySelectorAll('link[rel=stylesheet]').forEach((el) => {
          const href = el.getAttribute('href');

          if (endsWithURL(data.url, href)) {
            reload = false;

            el.setAttribute('href', href);
          }
        });

        // Hot reload images
        const refetchImages = new Map();

        document.querySelectorAll('img').forEach(async (el) => {
          const src = el.getAttribute('src');
          const srcset = el.getAttribute('srcset');

          if (
            src && endsWithURL(data.url, src) ||
            srcset && containsURL(srcset, data.url)
          ) {
            reload = false;

            let promise = refetchImages.get(data.url);

            if (!promise) {
              promise = fetch(data.url, { cache: 'reload' });
              refetchImages.set(data.url, promise);
            }

            await promise;

            if (src) el.setAttribute('src', src);
            if (srcset) el.setAttribute('srcset', srcset);
          }
        });

        // Otherwise, reload page
        if (reload) {
          location.reload();
        }
      });

      socket.addEventListener('open', () => {
        console.info('Development server connected');
      });

      socket.addEventListener('close', () => {
        console.warn('Development server disconnected');
      });
    }

    function endsWithURL(candidate, target) {
      return candidate.endsWith(target.replace(/^\\.?\\//, ''));
    }

    function containsURL(candidate, target) {
      return candidate.match(target.replace(/^\\.?\\//, ''));
    }`;
  }

  async resolveFileCached(file: string) {
    const cached = this.fileCache.get(file);
    if (cached) return cached;

    const promise = this.resolveFile(file);
    this.fileCache.set(file, promise);

    return promise;
  }

  async resolveFile(file: string) {
    if (file.match(/__DEV__\.js$/)) {
      return {
        contents: this.getClientScript(),
        contentType: 'application/javascript',
        version: '1',
      };
    }

    const stat = await fs.promises.lstat(file);

    if (stat.isDirectory()) {
      file = path.join(file, 'index.html');
    }

    const buffer = await fs.promises.readFile(file);
    const contents = await this.transformFileContents(file, buffer);
    const contentType = mime.getType(file) ?? 'application/octet-stream';
    const version = crypto.createHash('sha1').update(contents).digest('base64');

    return { contents, contentType, version };
  }

  invalidateFile(file: string) {
    this.fileCache.delete(file);
    this.fileCache.delete(file.replace(/index\.html$/, ''));
    this.fileCache.delete(file.replace(/\/index\.html$/, ''));
  }

  async close() {
    this.server.close();
    if (this.fileWatcher) this.fileWatcher.close();
  }
}
