{* Only the shell is ours. The module renders its own header, actions, tabs and contents. *}
<div class="overlayDetail mu-cloud-record detailViewContainer" data-mu-record-scripts="{$MU_RECORD_SCRIPTS|escape:'html'}" data-mu-record-styles="{$MU_RECORD_STYLES|escape:'html'}" data-mu-record-fields="{$FIELDS_INFO|escape:'html'}" data-mu-record-module="{$MODULE_NAME|escape:'html'}">
	<input type="hidden" id="recordId" value="{$RECORD->getId()}" />
	<div class="detailview-header-block">
		<div class="detailview-header">
			<div class="row">
				{include file='DetailViewHeaderTitle.tpl'|vtemplate_path:$MODULE_NAME}
				{include file='DetailViewActions.tpl'|vtemplate_path:$MODULE_NAME}
			</div>
		</div>
		{include file='DetailViewTagList.tpl'|vtemplate_path:$MODULE_NAME}
	</div>
	<div class="detailview-content container-fluid">
		{include file='ModuleRelatedTabs.tpl'|vtemplate_path:$MODULE_NAME}
		<div class="details row">{$MU_RECORD_BODY}</div>
	</div>
</div>
