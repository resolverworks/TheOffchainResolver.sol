import {ethers} from 'ethers';
import {createServer} from 'node:http';
import {EZCCIP} from '@resolverworks/ezccip';
import {createWriteStream} from 'node:fs';
import {fileURLToPath} from 'node:url';

export function print_header(s) {
	console.log();
	console.log(`*****[ ${s} ]`.padEnd(60, '*'));
}

export function capture_stdout(file) {
	let {stdout} = process;
	let out = createWriteStream(fileURLToPath(file));
	let old = stdout.write.bind(stdout);
	stdout.write = (...a) => {
		old(...a);
		out.write(...a);
	};
}

export function create_ccip_server({port, resolver, signingKey, resolve, log}) {
	const ezccip = new EZCCIP();
	ezccip.enableENSIP10(resolve);
	return new Promise(ful => {
		let http = createServer(async (req, reply) => {
			try {
				let v = [];
				for await (let x of req) v.push(x);
				let {sender, data: calldata} = JSON.parse(Buffer.concat(v));
				let {data, history} = await ezccip.handleRead(sender, calldata, {signingKey, resolver});
				log?.(history.toString());
				write_json(reply, {data});
			} catch (err) {
				log?.(err);
				reply.statusCode = err.status ?? 500;
				write_json(reply, {message: err.message});
			}
		});
		http.listen(port, () => {
			port = http.address().port;
			let context = `${ethers.computeAddress(signingKey)} http://localhost:${port}`;
			log?.('Ready!', context);
			ful({http, context, port});
		});
	});
}

function write_json(reply, json) {
	let buf = Buffer.from(JSON.stringify(json));
	reply.setHeader('content-length', buf.length);
	reply.setHeader('content-type', 'application/json');
	reply.end(buf);
}
