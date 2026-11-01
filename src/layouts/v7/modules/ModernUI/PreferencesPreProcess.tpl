{*
 * ModernUI: page header of the personal preferences (modules/ModernUI/views/Preferences.php).
 * The standard v7 top bar and app menu, then a plain content area without the module sidebar.
 *}
{strip}
{include file="modules/Vtiger/partials/Topbar.tpl"}
<div class="container-fluid app-nav">
	<div class="row">
		{include file="partials/SidebarHeader.tpl"|vtemplate_path:$MODULE}
		<div class="col-sm-11 col-xs-10 padding0 module-action-bar clearfix coloredBorderTop">
			<div class="module-action-content clearfix">
				<div class="col-lg-12 col-md-12 col-sm-12 col-xs-12 padding0 module-breadcrumb">
					<h4 class="module-title pull-left">{mu_t key='LBL_PREFERENCES_TITLE'}</h4>
				</div>
			</div>
		</div>
	</div>
</div>
</nav>
<div class="main-container clearfix">
	<div class="content-area full-width" id="modernui-preferences-page">
{/strip}
