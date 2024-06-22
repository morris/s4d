# ds1

Minimal web development server with live reload.

## Installation

```sh
npm install ds1 --save-dev # project local installation (preferred)
npm install ds1 --global # global installation
```

## Usage

```
ds1 [options] <webroot>

  --help, -h      Show this help.
  --host <host>   Set hostname. Default is "localhost".
                  Set "0.0.0.0" to expose over network.
  --port <port>   Set port. Default is 8080.
  --spa           Single-page application mode.
                  Serves /index.html for URLs that cannot be resolved to a file.
```

Examples:

```sh
ds1 public
ds1 --port 3000 public
ds1 --port 3000 --spa public
ds1 --port 3000 --host 0.0.0.0 --spa public # Expose over network
```

When installed locally in a project, run with `npx ds1 [args...]`,
unless running from an npm script.

## Live Reload Behavior

When a file under webroot is modified,
attempts to reload stylesheets and images in-place
if they match the modified file.
In all other cases, a hard page reload is triggered.
