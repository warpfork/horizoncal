import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import esBuildCopyStaticFiles from "esbuild-copy-static-files";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		// "obsidian-dataview",
		// "luxon", // i don't really know why we can't use the environmental one, but, this is loadbearing.
		...builtins,
	],
	plugins: [
		esBuildCopyStaticFiles({
			src: "./src/styles/styles.css",
			dest: "./out/styles.css",
			dereference: true,
			errorOnExist: false,
			preserveTimestamps: true,
		}),
		esBuildCopyStaticFiles({
			src: "./manifest.json",
			dest: "./out/manifest.json",
			dereference: true,
			errorOnExist: false,
			preserveTimestamps: true,
		}),
	],
	format: "cjs",
	target: "es2021",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "out/main.js",
	minify: prod,
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
