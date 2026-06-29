import * as net from "node:net";

/**
 * Probe a free TCP port on a loopback host by binding to port 0 and letting the
 * OS assign one, then closing the listener. Used ONCE when bootstrapping a fresh
 * Syncthing home so ccsync never collides with a user's own Syncthing on 8384.
 *
 * Note: this is inherently subject to TOCTOU — the port can be taken between the
 * probe and `syncthing serve` binding it. Callers handle that by retrying with a
 * fresh probe on bind failure.
 */
export async function probeFreePort(host = "127.0.0.1"): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const server = net.createServer();
		server.unref();
		server.once("error", reject);
		server.listen(0, host, () => {
			const address = server.address();
			if (address && typeof address === "object") {
				const { port } = address;
				server.close(() => resolve(port));
				return;
			}
			server.close(() => reject(new Error("could not determine a free port")));
		});
	});
}

/** Probe a free loopback port and format it as a Syncthing GUI address. */
export async function probeFreeGuiAddress(host = "127.0.0.1"): Promise<string> {
	const port = await probeFreePort(host);
	return `${host}:${port}`;
}
