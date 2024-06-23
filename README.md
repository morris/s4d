# s4d

Minimal web development server with live reload.

## Installation

```sh
npm install s4d --save-dev # project local installation (preferred)
npm install s4d --global # global installation
```

## Usage

```
s4d [options] <webroot>

  --help, -h      Show this help.
  --host <host>   Set hostname. Default is "localhost".
                  Set "0.0.0.0" to expose over network.
  --port <port>   Set port. Default is 8080.
  --spa           Single-page application mode.
                  Serves /index.html for URLs that cannot be resolved to a file.
```

Examples:

```sh
s4d public
s4d --port 3000 public
s4d --port 3000 --spa public
s4d --port 3000 --host 0.0.0.0 --spa public # Expose over network
```

When installed locally in a project, run with `npx s4d [args...]`,
unless running from an npm script.

## Live Reload Behavior

When a file under webroot is modified,
attempts to reload stylesheets and images in-place
if they match the modified file.
In all other cases, a hard page reload is triggered.
