{* Presentation only: native Users login and password recovery keep their fields, actions and validation. *}
{strip}
<link rel="stylesheet" href="{$MU_AUTH.css|escape}">
<main class="mu-auth" lang="{$MU_AUTH.locale|escape}" data-mu-auth="{$MU_AUTH.mode|escape}">
	<header class="mu-auth__header">
		<img class="mu-auth__logo" src="{$MU_AUTH.logo|escape}" alt="{$MU_AUTH.title|escape}" width="160" height="40">
		{if $MU_AUTH.notice}<p class="mu-auth__notice">{$MU_AUTH.notice|escape}</p>{/if}
	</header>
	<section class="mu-auth__content {if $MU_AUTH.mode neq 'login'}mu-auth__content--wide{/if}">
		{if $MU_AUTH.mode neq 'login'}<h1 class="mu-auth__title">{$MU_AUTH.text.resetTitle|escape}</h1>{/if}
		{if $MU_AUTH.message}
			<p class="mu-auth__message {if $MU_AUTH.success}mu-auth__message--success{/if}" role="{if $MU_AUTH.success}status{else}alert{/if}">{$MU_AUTH.message|escape}</p>
		{/if}
		{if $MU_AUTH.mode eq 'change'}
			{if !empty($LINK_EXPIRED)}
				<p class="mu-auth__message" role="alert">{$MU_AUTH.text.expired|escape}</p>
			{else}
				<form class="mu-auth__form" action="{$TRACKURL|escape}" method="post" id="changePassword" name="changePassword" accept-charset="UTF-8" data-mu-password-form data-mu-mismatch="{$MU_AUTH.text.mismatch|escape}">
					<input type="hidden" name="username" value="{$USERNAME|escape}">
					<input type="hidden" name="shorturl_id" value="{$SHORTURL_ID|escape}">
					<input type="hidden" name="secret_hash" value="{$SECRET_HASH|escape}">
					<label class="mu-auth__label" for="password">{$MU_AUTH.text.newPassword|escape}</label>
					<input class="mu-auth__input" id="password" name="password" type="password" autocomplete="new-password" required placeholder="{$MU_AUTH.text.newPassword|escape}">
					<label class="mu-auth__label" for="confirmPassword">{$MU_AUTH.text.confirmPassword|escape}</label>
					<input class="mu-auth__input" id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required placeholder="{$MU_AUTH.text.confirmPassword|escape}">
					<button class="mu-auth__button mu-auth__button--green" type="submit">{$MU_AUTH.text.savePassword|escape}<span aria-hidden="true"> →</span></button>
				</form>
			{/if}
		{elseif $MU_AUTH.mode eq 'recovery'}
			<form class="mu-auth__form" action="forgotPassword.php" method="post">
				<label class="mu-auth__label" for="fusername">{$MU_AUTH.text.username|escape}</label>
				<input class="mu-auth__input" id="fusername" name="username" type="text" autocomplete="username" required placeholder="{$MU_AUTH.text.username|escape}" autocapitalize="none" spellcheck="false">
				<label class="mu-auth__label" for="email">{$MU_AUTH.text.email|escape}</label>
				<input class="mu-auth__input" id="email" name="emailId" type="email" autocomplete="email" required placeholder="{$MU_AUTH.text.email|escape}" autocapitalize="none" spellcheck="false">
				<button class="mu-auth__button mu-auth__button--green" type="submit">{$MU_AUTH.text.proceed|escape}<span aria-hidden="true"> →</span></button>
			</form>
			<p class="mu-auth__help">{$MU_AUTH.text.help|escape}</p>
		{else}
			<form class="mu-auth__form" method="post" action="index.php">
				<input type="hidden" name="module" value="Users">
				<input type="hidden" name="action" value="Login">
				<label class="mu-auth__label" for="username">{$MU_AUTH.text.username|escape}</label>
				<input class="mu-auth__input" id="username" name="username" type="text" autocomplete="username" required placeholder="{$MU_AUTH.text.username|escape}" autocapitalize="none" spellcheck="false">
				<label class="mu-auth__label" for="password">{$MU_AUTH.text.password|escape}</label>
				<input class="mu-auth__input" id="password" name="password" type="password" autocomplete="current-password" required placeholder="{$MU_AUTH.text.password|escape}">
				<button class="mu-auth__button" type="submit">{$MU_AUTH.text.signIn|escape}</button>
			</form>
		{/if}
		<p class="mu-auth__links">
			{if $MU_AUTH.mode eq 'login'}<a href="{$MU_AUTH.recoveryUrl|escape}">{$MU_AUTH.text.forgot|escape}</a>
			{else}<a href="{$MU_AUTH.loginUrl|escape}">{$MU_AUTH.text.back|escape}</a>{/if}
		</p>
		{if $MU_AUTH.mode neq 'change'}
			<nav class="mu-auth__languages" aria-label="{$MU_AUTH.text.language|escape}">
				{foreach key=AUTH_LOCALE item=AUTH_LABEL from=['ru-RU' => 'Русский', 'en-US' => 'English', 'de-DE' => 'Deutsch']}
					<a href="index.php?module=Users&amp;view=Login&amp;authlang={$AUTH_LOCALE|escape}{if $MU_AUTH.mode eq 'recovery'}&amp;screen=recovery{/if}" lang="{$AUTH_LOCALE|escape}" {if $MU_AUTH.locale eq $AUTH_LOCALE}aria-current="true"{/if}>{$AUTH_LABEL|escape}</a>
				{/foreach}
			</nav>
		{/if}
	</section>
</main>
<script src="{$MU_AUTH.js|escape}" defer></script>
{/strip}
