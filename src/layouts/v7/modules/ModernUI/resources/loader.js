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
	watchPageContexts();

	/**
	 * The build caches only :has() predicates on :root, #page and .main-container; local selectors stay native CSS.
	 * Read the original predicates from an inactive rule in our stylesheet, without extra requests or inline code.
	 * Run synchronously here (before native DOM-ready controllers), then once per mutation batch. Early geometry in
	 * the selected skin is only a hint: actual extension markup, dialogs, checkbox selection and AJAX always win.
	 */
	function watchPageContexts() {
		if (!window.MutationObserver || !root.matches) {
			return;
		}
		/** @type {Record<string, any[]>} */
		var conditions = {};
		/** @type {CSSStyleSheet[]} */
		var sheets = [];
		/** @type {Element[]} */
		var previous = [];
		var marker = 'data-mu-context-';
		var attributes = ['class', 'id', 'checked', 'disabled', 'hidden', 'value', 'data-mu-failed'];
		var stopped = false;
		/** @type {string[]} */
		var volatile = [];
		var frame = 0;

		function read() {
			for (var i = 0; i < document.styleSheets.length; i++) {
				var sheet = document.styleSheets[i];
				if (!sheet || !sheet.href || sheet.href.indexOf(base) !== 0 || sheets.indexOf(sheet) !== -1) {
					continue;
				}
				try {
					for (var r = 0; r < sheet.cssRules.length; r++) {
						var rule = /** @type {CSSMediaRule} */ (sheet.cssRules[r]);
						if (!rule || !rule.media || rule.media.mediaText !== 'mu-page-contexts') { continue; }
						var data = /** @type {CSSStyleRule | undefined} */ (rule.cssRules[0]);
						if (!data || !data.style) { continue; }
						var value = data.style.getPropertyValue('--mu-page-contexts').trim();
						var entries = JSON.parse(decodeURIComponent(value.slice(1, -1)));
						for (var e = 0; e < entries.length; e++) {
							var entry = entries[e];
							if (Array.isArray(entry) && entry.length === 3 && /^[0-9a-f]{12}$/.test(entry[0])
								&& /^(?::root|#page|\.main-container)$/.test(entry[1]) && Array.isArray(entry[2])) {
								conditions[entry[0]] = entry;
								var pattern = /\[([A-Za-z0-9_-]+)/g;
								var match;
								var selectors = JSON.stringify(entry[2]);
								if (/:(checked|indeterminate)\b/.test(selectors) && volatile.indexOf(entry[0]) === -1) { volatile.push(entry[0]); }
								while ((match = pattern.exec(selectors)) !== null) {
									if (match[1] && attributes.indexOf(match[1]) === -1) { attributes.push(match[1]); }
								}
							}
						}
					}
					sheets.push(sheet);
				} catch (ignore) {
					// A sheet that is still loading is retried on its load event. Foreign sheets are never inspected.
				}
			}
			refresh();
			if (observer) { observe(); }
			if (!stopped && volatile.length && !frame) { frame = requestAnimationFrame(sample); }
		}

		/** @param {any[]} plan @param {Element} element @param {Record<string, boolean>} cache @returns {boolean} */
		function matches(plan, element, cache) {
			var operation = plan[0];
			if (operation === 'query' || operation === 'match') {
				var key = operation + plan[1];
				var cached = cache[key];
				if (typeof cached === 'boolean') { return cached; }
				var result = operation === 'query' ? element.querySelector(plan[1]) !== null : element.matches(plan[1]);
				cache[key] = result;
				return result;
			}
			if (operation === 'not') { return !matches(plan[1], element, cache); }
			for (var i = 1; i < plan.length; i++) {
				var yes = matches(plan[i], element, cache);
				if (operation === 'all' && !yes) { return false; }
				if (operation === 'any' && yes) { return true; }
			}
			return operation === 'all';
		}

		/** @param {Element} element @param {string} id @param {Record<string, boolean>} cache */
		function update(element, id, cache) {
			var condition = conditions[id];
			var present = !!condition && element.matches(condition[1]) && matches(condition[2], element, cache);
			var attribute = marker + id;
			if (present && !element.hasAttribute(attribute)) { element.setAttribute(attribute, ''); }
			else if (!present && element.hasAttribute(attribute)) { element.removeAttribute(attribute); }
		}

		// Checkbox properties do not emit mutations. Sample just these bounded queries before paint, so a native
		// .prop('checked', ...) has the same visual result without replacing setters or waiting for a user event.
		function sample() {
			frame = 0;
			if (stopped) { return; }
			for (var p = 0; p < previous.length; p++) {
				var element = previous[p];
				if (!element) { continue; }
				var cache = Object.create(null);
				for (var v = 0; v < volatile.length; v++) {
					var id = volatile[v];
					if (id) { update(element, id, cache); }
				}
			}
			frame = requestAnimationFrame(sample);
		}

		function refresh() {
			if (stopped) { return; }
			if (root.classList.contains('mu-off') || root.hasAttribute('data-mu-failed')) { stop(); return; }
			var nodes = document.querySelectorAll(':root, #page, .main-container');
			/** @type {Element[]} */
			var current = [];
			for (var n = 0; n < nodes.length; n++) {
				var element = nodes[n];
				if (!element) { continue; }
				/** @type {Record<string, boolean>} */
				var cache = Object.create(null);
				for (var id in conditions) {
					update(element, id, cache);
				}
				current.push(element);
			}
			for (var p = 0; p < previous.length; p++) {
				var old = previous[p];
				if (old && current.indexOf(old) === -1) {
					for (var oldId in conditions) { old.removeAttribute(marker + oldId); }
				}
			}
			previous = current;
			if (Object.keys(conditions).length && !root.hasAttribute('data-mu-contexts-ready')) {
				root.setAttribute('data-mu-contexts-ready', '');
			}
		}

		read();
		if (stopped) { return; }
		var observer = new MutationObserver(function (records) {
			for (var i = 0; i < records.length; i++) {
				var record = records[i];
				if (record) {
					refresh();
					break;
				}
			}
		});
		function observe() {
			if (!stopped) { observer.observe(document, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: attributes }); }
		}
		observe();
		/** @param {Event} event */
		function loaded(event) {
			if (event.target instanceof HTMLLinkElement && event.target.rel === 'stylesheet') { read(); }
		}
		function stop() {
			stopped = true;
			if (observer) { observer.disconnect(); }
			if (frame) { cancelAnimationFrame(frame); frame = 0; }
			document.removeEventListener('load', loaded, true);
			document.removeEventListener('change', refresh, true);
			document.removeEventListener('input', refresh, true);
			for (var i = 0; i < previous.length; i++) {
				var element = previous[i];
				if (element) { for (var id in conditions) { element.removeAttribute(marker + id); } }
			}
			previous = []; sheets = []; conditions = {}; volatile = [];
		}
		document.addEventListener('load', loaded, true);
		document.addEventListener('change', refresh, true);
		document.addEventListener('input', refresh, true);
	}

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
		// The skin already includes the shell geometry. Loading it twice invalidated the entire list again when the
		// island CSS arrived. Keep the same fallback for a missing skin, without duplicating it on successful pages.
		var skins = document.querySelectorAll('link[rel="stylesheet"][href*="/ModernUI/resources/dist/assets/skin-"]');
		var hasSkin = false;
		for (var s = 0; s < skins.length; s++) {
			var skin = /** @type {HTMLLinkElement | undefined} */ (skins[s]);
			if (skin && skin.sheet) { hasSkin = true; }
		}
		var fallback = manifest['src/skin/shell-fallback.scss'];
		if (!hasSkin && fallback && typeof fallback.file === 'string' && ASSET_PATTERN.test(fallback.file)) {
			css.push(fallback.file);
		}
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
