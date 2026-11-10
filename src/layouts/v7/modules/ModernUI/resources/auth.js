/* Progressive enhancement only. Native forms and links work with JavaScript disabled. */
(function () {
	'use strict';
	var root = document.querySelector('[data-mu-auth]');
	if (!root) { return; }
	document.documentElement.lang = root.lang;
	var form = root.querySelector('[data-mu-password-form]');
	if (form) {
		var password = form.querySelector('[name="password"]');
		var confirmation = form.querySelector('[name="confirmPassword"]');
		var validate = function () {
			confirmation.setCustomValidity(password.value !== confirmation.value ? form.getAttribute('data-mu-mismatch') : '');
		};
		password.addEventListener('input', validate);
		confirmation.addEventListener('input', validate);
	}
}());
