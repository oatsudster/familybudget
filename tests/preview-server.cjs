// Serves a fixture-backed app; Firebase scripts are removed before the page reaches the browser.
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
const allowed = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "manifest.json",
  "icon-192.png",
  "icon-180.png",
  "icon-512.png",
]);
const fake = fs.readFileSync(path.join(__dirname, "fake-firebase.cjs"), "utf8");
http
  .createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/preview-fixture.js") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      return res.end(
        fake +
          `\nconst d=new Date(); const day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); installFakeFirebase(window,{transactions:[{id:'sample-income',type:'income',category:'salary',amount:20000,date:day,time:'08:00',note:'เงินเดือน'},{id:'sample-expense',type:'expense',category:'shopping',amount:7500,date:day,time:'10:00',note:'ซื้อของเข้าบ้าน'}],amwayItems:[{id:'sample-product',name:'วิตามินตัวอย่าง',price:250}]});`,
      );
    }
    const file = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!allowed.has(file)) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const mime = file.endsWith(".css")
      ? "text/css"
      : file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".png")
          ? "image/png"
          : file.endsWith(".json")
            ? "application/json"
            : "text/html";
    res.setHeader("Content-Type", mime + "; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (file === "index.html") {
      let html = fs
        .readFileSync(path.join(root, file), "utf8")
        .replace(/<script src="https:\/\/www.gstatic.com[^>]+><\/script>/g, "")
        .replace(
          '<script src="app.js">',
          '<script src="preview-fixture.js"></script><script src="app.js">',
        );
      if (
        new URL(req.url, "http://localhost").searchParams.get("text") === "200"
      )
        html = html.replace(
          "</head>",
          "<style>:root{font-size:40px!important}</style></head>",
        );
      return res.end(html);
    }
    res.end(fs.readFileSync(path.join(root, file)));
  })
  .listen(4173, "127.0.0.1", () =>
    console.log(
      "Fixture preview: http://127.0.0.1:4173/?h=11111111-2222-4333-8444-555555555555",
    ),
  );
