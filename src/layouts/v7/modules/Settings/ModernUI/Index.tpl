{*
 * ModernUI: Settings → Other settings → ModernUI (modules/Settings/ModernUI/views/Index.php).
 * Status and switches are plain HTML forms (work without JavaScript); the frontend check is a Vue island.
 *}
{strip}
<div class="modernui-page detailViewContainer" lang="{$MU_LOCALE|escape}">
	<div class="col-lg-12 col-md-12 col-sm-12 col-xs-12">
		<div class="contents">
			<div class="clearfix">
				<h4 class="pull-left">{mu_t key='LBL_TITLE'}</h4>
			</div>
			<hr>
			{if $MU_MESSAGE}
				<div class="alert alert-{$MU_MESSAGE.kind}" role="status">{mu_t key=$MU_MESSAGE.key}</div>
			{/if}
			{if $MU_STATUS.notice eq 'MU_REINSTALLED_THEME_OFF'}
				<div class="alert alert-info" role="status">{mu_t key='LBL_NOTICE_REINSTALLED'}</div>
			{/if}
			{if !$MU_STATUS.moduleActive}
				<div class="alert alert-warning" role="alert">{mu_t key='LBL_MODULE_DISABLED'}</div>
			{/if}
			{if !$MU_STATUS.vtigerSupported}
				<div class="alert alert-warning" role="alert">{mu_t key='LBL_VTIGER_UNSUPPORTED' version=$MU_STATUS.vtigerVersion}</div>
			{/if}
			{if $MU_STATUS.schemaState eq 'newer'}
				<div class="alert alert-danger" role="alert">{mu_t key='LBL_SCHEMA_NEWER'}</div>
			{elseif $MU_STATUS.schemaState neq 'current'}
				<div class="alert alert-danger" role="alert">{mu_t key='LBL_SCHEMA_NEEDS_RECOVERY'}</div>
			{/if}

			<h5><strong>{mu_t key='LBL_SECTION_STATUS'}</strong></h5>
			<table class="table table-bordered modernui-status">
				<tbody>
					<tr>
						<th scope="row">{mu_t key='LBL_MODULE_VERSION'}</th>
						<td>{$MU_STATUS.moduleVersion|escape} — {if $MU_STATUS.moduleActive}{mu_t key='LBL_ENABLED'}{else}{mu_t key='LBL_DISABLED'}{/if}</td>
					</tr>
					<tr>
						<th scope="row">{mu_t key='LBL_VTIGER_VERSION'}</th>
						<td>{$MU_STATUS.vtigerVersion|escape} — {if $MU_STATUS.vtigerSupported}{mu_t key='LBL_SUPPORTED'}{else}{mu_t key='LBL_NOT_SUPPORTED'}{/if}</td>
					</tr>
					<tr>
						<th scope="row">{mu_t key='LBL_BUILD'}</th>
						<td>{if $MU_STATUS.buildAvailable}<code>{$MU_STATUS.build|escape}</code>{else}{mu_t key='LBL_BUILD_MISSING'}{/if}</td>
					</tr>
					<tr>
						<th scope="row">{mu_t key='LBL_SCHEMA'}</th>
						<td>
							{if isset($MU_STATUS.schemaDb)}{$MU_STATUS.schemaDb|escape}{else}—{/if} / {$MU_STATUS.schemaCode|escape} —&nbsp;
							{mu_t key="LBL_SCHEMA_STATE_`$MU_STATUS.schemaState`"}
						</td>
					</tr>
					{if $MU_STATUS.moduleActive && $MU_STATUS.vtigerSupported}
						<tr>
							<th scope="row">{mu_t key='LBL_LINKS'}</th>
							<td>{if $MU_STATUS.linksOk}{mu_t key='LBL_LINKS_OK'}{else}{mu_t key='LBL_LINKS_MISSING'}{/if}</td>
						</tr>
					{/if}
					{if $MU_READY}
						<tr>
							<th scope="row">{mu_t key='LBL_THEME_MODE'}</th>
							<td>
								{mu_t key="LBL_MODE_`$MU_THEME.mode`"}
								{if $MU_THEME.mode eq 'pilot'}&nbsp;({mu_t key='LBL_PILOT_COUNTS' users=$MU_THEME.pilotUsers roles=$MU_THEME.pilotRoles})
								{elseif $MU_THEME.mode eq 'off' && ($MU_THEME.pilotUsers > 0 || $MU_THEME.pilotRoles > 0)}&nbsp;({mu_t key='LBL_PILOT_KEPT' users=$MU_THEME.pilotUsers roles=$MU_THEME.pilotRoles}){/if}
							</td>
						</tr>
						<tr>
							<th scope="row">{mu_t key='LBL_FOR_ME'}</th>
							<td>
								{if $MU_THEME.activeForMe}
									{mu_t key='LBL_ACTIVE_FOR_ME'}
								{else}
									{mu_t key='LBL_INACTIVE_FOR_ME'}&nbsp;{mu_t key="LBL_REASON_`$MU_THEME.reason`" module='ModernUI'}
								{/if}
							</td>
						</tr>
					{/if}
					{if $MU_STATUS.lastError}
						<tr>
							<th scope="row">{mu_t key='LBL_LAST_ERROR'}</th>
							<td><code>{$MU_STATUS.lastError|escape}</code></td>
						</tr>
					{/if}
				</tbody>
			</table>

			{if $MU_READY}
				<h5><strong>{mu_t key='LBL_SECTION_SWITCH'}</strong></h5>
				<p>{mu_t key='LBL_SWITCH_HELP'}</p>
				<div class="modernui-actions">
					{if $MU_CAN_ENABLE_FOR_ME}
						<form method="post" action="index.php" class="modernui-inline-form">
							<input type="hidden" name="module" value="ModernUI">
							<input type="hidden" name="parent" value="Settings">
							<input type="hidden" name="action" value="Toggle">
							<input type="hidden" name="mode" value="enableForMe">
							<input type="hidden" name="__vtrftk" value="{$MU_CSRF|escape}">
							<button type="submit" class="btn btn-success" name="modernui-enable-for-me">{mu_t key='LBL_ENABLE_FOR_ME'}</button>
						</form>
					{/if}
					{if $MU_CAN_DISABLE_FOR_ME}
						<form method="post" action="index.php" class="modernui-inline-form">
							<input type="hidden" name="module" value="ModernUI">
							<input type="hidden" name="parent" value="Settings">
							<input type="hidden" name="action" value="Toggle">
							<input type="hidden" name="mode" value="disableForMe">
							<input type="hidden" name="__vtrftk" value="{$MU_CSRF|escape}">
							<button type="submit" class="btn btn-default" name="modernui-disable-for-me">{mu_t key='LBL_DISABLE_FOR_ME'}</button>
						</form>
					{/if}
					{if $MU_CAN_DISABLE_FOR_ALL}
						<form method="post" action="index.php" class="modernui-inline-form">
							<input type="hidden" name="module" value="ModernUI">
							<input type="hidden" name="parent" value="Settings">
							<input type="hidden" name="action" value="Toggle">
							<input type="hidden" name="mode" value="disableForAll">
							<input type="hidden" name="__vtrftk" value="{$MU_CSRF|escape}">
							<button type="submit" class="btn btn-danger" name="modernui-disable-for-all">{mu_t key='LBL_DISABLE_FOR_ALL'}</button>
						</form>
					{/if}
				</div>
				{if $MU_THEME.standardView}
					<p class="help-block">{mu_t key='LBL_YOU_CHOSE_STANDARD_VIEW'}</p>
				{/if}
				{if $MU_PILOT}
					<h5><strong>{mu_t key='LBL_SECTION_PILOT'}</strong></h5>
					<p>{mu_t key='LBL_PILOT_HELP'}</p>
					<div class="row modernui-pilot">
						{foreach item=KIND from=['user', 'role']}
							{if $KIND eq 'user'}
								{assign var=ENTRIES value=$MU_PILOT.users}
								{assign var=OPTIONS value=$MU_PILOT.userOptions}
							{else}
								{assign var=ENTRIES value=$MU_PILOT.roles}
								{assign var=OPTIONS value=$MU_PILOT.roleOptions}
							{/if}
							<div class="col-sm-6">
								<table class="table table-bordered table-condensed modernui-pilot-{$KIND}s">
									<caption>{if $KIND eq 'user'}{mu_t key='LBL_PILOT_USERS'}{else}{mu_t key='LBL_PILOT_ROLES'}{/if}</caption>
									<tbody>
										{foreach item=ENTRY from=$ENTRIES}
											<tr data-mu-pilot-{$KIND}="{$ENTRY.id|escape}">
												<td>{$ENTRY.label|escape}</td>
												<td class="text-right">
													<form method="post" action="index.php" class="modernui-inline-form">
														<input type="hidden" name="module" value="ModernUI">
														<input type="hidden" name="parent" value="Settings">
														<input type="hidden" name="action" value="Toggle">
														<input type="hidden" name="mode" value="{if $KIND eq 'user'}pilotRemoveUser{else}pilotRemoveRole{/if}">
														<input type="hidden" name="{$KIND}" value="{$ENTRY.id|escape}">
														<input type="hidden" name="__vtrftk" value="{$MU_CSRF|escape}">
														<button type="submit" class="btn btn-default btn-xs" name="modernui-pilot-remove-{$KIND}" aria-label="{mu_t key='LBL_PILOT_REMOVE_LABEL' name=$ENTRY.label}">{mu_t key='LBL_PILOT_REMOVE'}</button>
													</form>
												</td>
											</tr>
										{foreachelse}
											<tr><td class="text-muted">{if $KIND eq 'user'}{mu_t key='LBL_PILOT_NO_USERS'}{else}{mu_t key='LBL_PILOT_NO_ROLES'}{/if}</td></tr>
										{/foreach}
									</tbody>
								</table>
								{if $OPTIONS}
									<form method="post" action="index.php" class="form-inline modernui-pilot-add">
										<input type="hidden" name="module" value="ModernUI">
										<input type="hidden" name="parent" value="Settings">
										<input type="hidden" name="action" value="Toggle">
										<input type="hidden" name="mode" value="{if $KIND eq 'user'}pilotAddUser{else}pilotAddRole{/if}">
										<input type="hidden" name="__vtrftk" value="{$MU_CSRF|escape}">
										<label class="sr-only" for="modernui-pilot-{$KIND}">{if $KIND eq 'user'}{mu_t key='LBL_PILOT_CHOOSE_USER'}{else}{mu_t key='LBL_PILOT_CHOOSE_ROLE'}{/if}</label>
										<select class="form-control input-sm" id="modernui-pilot-{$KIND}" name="{$KIND}">
											{foreach item=OPTION from=$OPTIONS}
												<option value="{$OPTION.id|escape}">{$OPTION.label|escape}</option>
											{/foreach}
										</select>&nbsp;
										<button type="submit" class="btn btn-default btn-sm" name="modernui-pilot-add-{$KIND}">{if $KIND eq 'user'}{mu_t key='LBL_PILOT_ADD_USER'}{else}{mu_t key='LBL_PILOT_ADD_ROLE'}{/if}</button>
									</form>
								{/if}
							</div>
						{/foreach}
					</div>
				{/if}
				<p><a href="index.php?module=ModernUI&amp;view=Preferences">{mu_t key='LBL_OPEN_PREFERENCES'}</a></p>
				{if $MU_SETTINGS_WARNINGS > 0}
					<p class="text-warning">{mu_t key='LBL_SETTINGS_WARNINGS' count=$MU_SETTINGS_WARNINGS}</p>
				{/if}
			{/if}

			<h5><strong>{mu_t key='LBL_SECTION_RECOVERY'}</strong></h5>
			<p>
				{if $MU_SAFE_MODE}
					{mu_t key='LBL_SAFE_MODE_ON'}&nbsp;<a href="index.php?module=ModernUI&amp;parent=Settings&amp;view=Index&amp;modernui=on">{mu_t key='LBL_SAFE_MODE_LEAVE'}</a>
				{else}
					{mu_t key='LBL_SAFE_MODE_HELP'}&nbsp;<a href="index.php?modernui=off"><code>index.php?modernui=off</code></a>
				{/if}
			</p>
			<p>{mu_t key='LBL_RECOVERY_HELP'}</p>
			<form method="post" action="index.php" class="modernui-inline-form">
				<input type="hidden" name="module" value="ModernUI">
				<input type="hidden" name="parent" value="Settings">
				<input type="hidden" name="action" value="Recovery">
				<input type="hidden" name="__vtrftk" value="{$MU_CSRF|escape}">
				<button type="submit" class="btn btn-default" name="modernui-recovery">{mu_t key='LBL_RECOVERY'}</button>
			</form>

			<h5><strong>{mu_t key='LBL_SECTION_FRONTEND'}</strong></h5>
			<div class="modernui-diagnostics" data-mu-root="settings-diagnostics" data-mu-build="{$MU_BUILD|escape}">
				<p class="text-muted">{if $MU_ASSETS.script}{mu_t key='LBL_FRONTEND_WAITING'}{else}{mu_t key='LBL_BUILD_MISSING'}{/if}</p>
			</div>
			{foreach item=CSS from=$MU_ASSETS.css}
				<link rel="stylesheet" href="{$CSS|escape}">
			{/foreach}
			{foreach item=PRELOAD from=$MU_ASSETS.preload}
				<link rel="modulepreload" href="{$PRELOAD|escape}">
			{/foreach}
			{if $MU_ASSETS.script}
				<script type="module" src="{$MU_ASSETS.script|escape}"></script>
			{/if}
		</div>
	</div>
</div>
{/strip}
