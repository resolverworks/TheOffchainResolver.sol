import {createWriteStream} from 'node:fs';

export function print_header(s) {
	console.log();
	console.log(`*****[ ${s} ]`.padEnd(80, '*'));
}

export function capture_stdout(file) {
	let {stdout} = process;
	let out = createWriteStream(file);
	let old = stdout.write.bind(stdout);
	stdout.write = (...a) => {
		old(...a);
		out.write(...a);
	};
}
