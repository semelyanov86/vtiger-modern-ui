// @ts-check
/*
 * ModernUI loader (docs/architecture.md §5.3).
 *
 * Vtiger prints HEADERSCRIPT links as classic <script type="text/javascript">, so the Vue islands (ES modules)
 * are started from here: read dist/manifest.json, add the stylesheets of the shell entry and a
 * <script type="module"> for it. ES5 on purpose and without a build step: it must run in any browser and
 * never break the page. Whatever goes wrong, the standard v7 interface stays as it is.
 *
 * The link handler prints this file as loader.js?b=<build id>&z=?v=<vtiger version>. The design tokens of the user
 * come with their own render-blocking stylesheet (action=Tokens), so nothing has to be restored here before the
 * first paint.
 */
(function () {
	'use strict';

	var WATCHDOG_MS = 15000;
	var SHELL_ENTRY = 'src/shell/main.ts';
	var ASSET_PATTERN = /^assets\/[A-Za-z0-9._-]+$/;
	var root = document.documentElement;

	/** @param {string} message */
	function warn(message) {
		if (window.console && window.console.warn) {
			window.console.warn('[ModernUI] ' + message);
		}
	}

	/**
	 * @param {string} query
	 * @param {string} name
	 * @returns {string}
	 */
	function param(query, name) {
		var match = new RegExp('(?:^|[?&])' + name + '=([A-Za-z0-9_-]*)').exec(query);
		return match && match[1] ? match[1] : '';
	}

	var script = /** @type {HTMLScriptElement | null} */ (document.currentScript);
	if (!script || !script.src || root.getAttribute('data-mu-build')) {
		return;
	}
	var src = script.src;
	var queryStart = src.indexOf('?');
	var query = queryStart >= 0 ? src.substring(queryStart) : '';
	var base = (queryStart >= 0 ? src.substring(0, queryStart) : src).replace(/[^/]*$/, '') + 'dist/';
	var build = param(query, 'b');
	if (!build) {
		return;
	}
	if (!('noModule' in document.createElement('script'))) {
		// No ES modules in this browser: the skin alone, the v7 interface keeps working.
		return;
	}
	if (/[?&]modernui=off(?:&|$)/.test(window.location.search)) {
		return;
	}

	root.setAttribute('data-mu-build', build);
	root.className += (root.className ? ' ' : '') + 'mu-pending';

	var finished = false;

	function removePending() {
		root.className = (' ' + root.className + ' ').replace(' mu-pending ', ' ').replace(/^\s+|\s+$/g, '');
	}

	/** @param {string} code */
	function fail(code) {
		if (finished) {
			return;
		}
		finished = true;
		removePending();
		root.setAttribute('data-mu-failed', code);
		// The geometry reserved for the new interface is gone. Widgets of v7 that measured it in the meantime (the floating
		// table header of lists, scroll bars) measure again on a resize; otherwise the floating header of a list covers its
		// first row (stage 19).
		window.setTimeout(function () {
			window.dispatchEvent(new Event('resize'));
		}, 0);
		warn('the new interface did not start (' + code + '), the standard interface stays');
	}

	var watchdog = window.setTimeout(function () {
		fail('timeout');
	}, WATCHDOG_MS);

	document.addEventListener('mu:ready', function () {
		finished = true;
		window.clearTimeout(watchdog);
		removePending();
		root.removeAttribute('data-mu-failed');
	});
	document.addEventListener('mu:failed', function (event) {
		window.clearTimeout(watchdog);
		var detail = /** @type {CustomEvent} */ (event).detail;
		fail(typeof detail === 'string' ? detail : 'shell-failed');
	});

	var request = new XMLHttpRequest();
	request.open('GET', base + 'manifest.json?b=' + build, true);
	/**
	 * Is the value an array (ES5, no Array.isArray polyfill needed)?
	 * @param {unknown} value
	 * @returns {value is unknown[]}
	 */
	function isList(value) {
		return Object.prototype.toString.call(value) === '[object Array]';
	}

	/**
	 * Stylesheets of an entry and of every chunk it imports (the backend integration contract of Vite).
	 * @param {Record<string, any>} manifest
	 * @param {string} name
	 * @param {Record<string, boolean>} seen
	 * @param {string[]} files
	 */
	function collectCss(manifest, name, seen, files) {
		var chunk = manifest[name];
		if (seen[name] || !chunk || typeof chunk !== 'object') {
			return;
		}
		seen[name] = true;
		var css = isList(chunk.css) ? chunk.css : [];
		for (var i = 0; i < css.length; i++) {
			if (typeof css[i] === 'string' && ASSET_PATTERN.test(css[i])) {
				files.push(css[i]);
			}
		}
		var imports = isList(chunk.imports) ? chunk.imports : [];
		for (var j = 0; j < imports.length; j++) {
			if (typeof imports[j] === 'string') {
				collectCss(manifest, imports[j], seen, files);
			}
		}
	}

	request.onload = function () {
		/** @type {Record<string, any> | null} */
		var manifest = null;
		try {
			var parsed = request.status === 200 ? JSON.parse(request.responseText) : null;
			manifest = parsed && typeof parsed === 'object' ? parsed : null;
		} catch (error) {
			manifest = null;
		}
		var entry = manifest ? manifest[SHELL_ENTRY] : null;
		if (!manifest || !entry || typeof entry.file !== 'string' || !ASSET_PATTERN.test(entry.file)) {
			fail('manifest-invalid');
			return;
		}
		var head = document.head || document.getElementsByTagName('head')[0];
		/** @type {string[]} */
		var css = [];
		collectCss(manifest, SHELL_ENTRY, {}, css);
		for (var i = 0; i < css.length; i++) {
			var link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = base + css[i];
			link.setAttribute('data-mu-asset', 'shell');
			head.appendChild(link);
		}
		var module = document.createElement('script');
		module.type = 'module';
		module.src = base + entry.file;
		module.setAttribute('data-mu-asset', 'shell');
		module.onerror = function () {
			fail('entry-load');
		};
		head.appendChild(module);
	};
	request.onerror = function () {
		fail('manifest-load');
	};
	request.send();
})();
