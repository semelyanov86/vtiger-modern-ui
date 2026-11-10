<?php
/* Installation is an explicit administrator POST, never part of a normal module install/update. */
require_once 'modules/ModernUI/models/AuthInstaller.php';
require_once 'modules/ModernUI/models/Page.php';

class Settings_ModernUI_AuthPages_Action extends Settings_Vtiger_Basic_Action {

	public function process(Vtiger_Request $request) {
		$mode = $request->getMode();
		$message = 'auth_installed';
		try {
			if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !in_array($mode, array('install', 'restore'), true)
				|| !ModernUI_Activation_Model::isSupportedVtiger() || !vtlib_isModuleActive('ModernUI')) {
				throw new RuntimeException('MU_BAD_REQUEST');
			}
			$manifest = ModernUI_Assets_Model::manifest();
			if ($mode === 'install' && (!ModernUI_Assets_Model::isAvailable() || !isset($manifest['src/auth/auth.scss']['file'])
				|| !is_file(ModernUI_Assets_Model::crmRoot() . '/' . ModernUI_Assets_Model::DIST . '/' . $manifest['src/auth/auth.scss']['file']))) {
				throw new RuntimeException('MU_AUTH_WRITE');
			}
			(new ModernUI_AuthInstaller_Model())->apply($mode === 'install');
			$message = $mode === 'install' ? 'auth_installed' : 'auth_restored';
		} catch (Throwable $e) {
			$message = $e->getMessage() === 'MU_AUTH_CONFLICT' || $e->getMessage() === 'MU_AUTH_BACKUP' ? 'error_auth_conflict' : 'error_auth_write';
		}
		header('Location: index.php?module=ModernUI&parent=Settings&view=Index&result=' . $message
			. ($request->get('editor') === 'off' ? '&editor=off' : ''), true, 303);
	}
}
