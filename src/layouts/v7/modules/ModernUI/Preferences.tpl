{*
 * ModernUI: personal preferences of the theme (modules/ModernUI/views/Preferences.php).
 * A server form without JavaScript: the user can always switch the new interface off for themselves.
 *}
{strip}
<div class="modernui-page" lang="{$MU_LOCALE|escape}">
	<div class="col-lg-8 col-md-10 col-sm-12 col-xs-12">
		{if $MU_MESSAGE}
			<div class="alert alert-{$MU_MESSAGE.kind}" role="status">{mu_t key=$MU_MESSAGE.key}</div>
		{/if}
		{if !$MU_READY}
			<div class="alert alert-warning" role="alert">{mu_t key='LBL_NOT_READY'}</div>
		{else}
			<h4>{mu_t key='LBL_STATUS'}</h4>
			<p>
				{if $MU_ACTIVE}
					{mu_t key='LBL_STATUS_ACTIVE'}
				{else}
					{mu_t key='LBL_STATUS_INACTIVE'}&nbsp;{mu_t key="LBL_REASON_`$MU_REASON`"}
				{/if}
			</p>
			{if $MU_CAN_LOCALE || $MU_CAN_DENSITY || $MU_CAN_FONT_SCALE || $MU_CAN_OPT_OUT || $MU_CAN_SELF_ENABLE}
				<form method="post" action="index.php" class="form-horizontal modernui-preferences-form">
					<input type="hidden" name="module" value="ModernUI">
					<input type="hidden" name="action" value="Preferences">
					<input type="hidden" name="mode" value="save">
					<input type="hidden" name="__vtrftk" value="{$MU_CSRF|escape}">
					{if $MU_CAN_LOCALE}
						<div class="form-group">
							<label class="col-sm-4 control-label" for="modernui-locale">{mu_t key='LBL_LANGUAGE'}</label>
							<div class="col-sm-6">
								<select id="modernui-locale" name="locale" class="form-control">
									{foreach item=CODE from=$MU_LOCALES}
										<option value="{$CODE|escape}"{if $MU_VALUES.locale eq $CODE} selected{/if}>{mu_t key="LBL_LOCALE_`$CODE`"}</option>
									{/foreach}
								</select>
								<p class="help-block">{mu_t key='LBL_LANGUAGE_HELP'}</p>
							</div>
						</div>
					{/if}
					{if $MU_CAN_DENSITY}
						<div class="form-group">
							<label class="col-sm-4 control-label" for="modernui-density">{mu_t key='LBL_DENSITY'}</label>
							<div class="col-sm-6">
								<select id="modernui-density" name="density" class="form-control">
									<option value=""{if $MU_VALUES.density eq ''} selected{/if}>{mu_t key='LBL_AS_ADMIN_SET'}</option>
									{foreach item=CODE from=$MU_DENSITIES}
										<option value="{$CODE|escape}"{if $MU_VALUES.density eq $CODE} selected{/if}>{mu_t key="LBL_DENSITY_`$CODE`"}</option>
									{/foreach}
								</select>
							</div>
						</div>
					{/if}
					{if $MU_CAN_FONT_SCALE}
						<div class="form-group">
							<label class="col-sm-4 control-label" for="modernui-font-scale">{mu_t key='LBL_FONT_SCALE'}</label>
							<div class="col-sm-6">
								<select id="modernui-font-scale" name="fontScale" class="form-control">
									<option value=""{if $MU_VALUES.fontScale eq ''} selected{/if}>{mu_t key='LBL_AS_ADMIN_SET'}</option>
									{foreach item=CODE from=$MU_FONT_SCALES}
										<option value="{$CODE|escape}"{if $MU_VALUES.fontScale eq $CODE} selected{/if}>{mu_t key="LBL_FONT_SCALE_`$CODE`"}</option>
									{/foreach}
								</select>
								<p class="help-block">{mu_t key='LBL_APPEARANCE_HELP'}</p>
							</div>
						</div>
					{/if}
					{if $MU_CAN_OPT_OUT}
						<div class="form-group">
							<div class="col-sm-offset-4 col-sm-8">
								<div class="checkbox">
									<label>
										<input type="hidden" name="standardView" value="0">
										<input type="checkbox" name="standardView" value="1"{if $MU_VALUES.standardView} checked{/if}>&nbsp;{mu_t key='LBL_STANDARD_VIEW'}
									</label>
								</div>
								<p class="help-block">{mu_t key='LBL_STANDARD_VIEW_HELP'}</p>
							</div>
						</div>
					{/if}
					{if $MU_CAN_SELF_ENABLE}
						<div class="form-group">
							<div class="col-sm-offset-4 col-sm-8">
								<div class="checkbox">
									<label>
										<input type="hidden" name="selfEnabled" value="0">
										<input type="checkbox" name="selfEnabled" value="1"{if $MU_VALUES.selfEnabled} checked{/if}>&nbsp;{mu_t key='LBL_SELF_ENABLE'}
									</label>
								</div>
							</div>
						</div>
					{/if}
					<div class="form-group">
						<div class="col-sm-offset-4 col-sm-8">
							<button type="submit" class="btn btn-success">{mu_t key='LBL_SAVE'}</button>
						</div>
					</div>
				</form>
			{else}
				<p>{mu_t key='LBL_NOTHING_TO_CHANGE'}</p>
			{/if}
			{if $MU_HAS_PERSONAL}
				<form method="post" action="index.php" class="modernui-reset-form">
					<input type="hidden" name="module" value="ModernUI">
					<input type="hidden" name="action" value="Preferences">
					<input type="hidden" name="mode" value="clear">
					<input type="hidden" name="__vtrftk" value="{$MU_CSRF|escape}">
					<button type="submit" class="btn btn-default">{mu_t key='LBL_RESET_PERSONAL'}</button>
				</form>
			{/if}
		{/if}
		<hr>
		<h4>{mu_t key='LBL_SAFE_MODE_TITLE'}</h4>
		{if $MU_SAFE_MODE}
			<p>{mu_t key='LBL_SAFE_MODE_ON'}</p>
			<p><a class="btn btn-default" href="index.php?module=ModernUI&amp;view=Preferences&amp;modernui=on">{mu_t key='LBL_SAFE_MODE_LEAVE'}</a></p>
		{else}
			<p>{mu_t key='LBL_SAFE_MODE_HELP'}</p>
			<p><a class="btn btn-default" href="index.php?modernui=off">{mu_t key='LBL_SAFE_MODE_ENTER'}</a></p>
		{/if}
	</div>
</div>
{/strip}
