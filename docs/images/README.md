# README screenshots

These are actual ModernUI browser captures from an isolated installation of official Vtiger
CRM Open Source 8.4.0. People, organizations, addresses, phone numbers and business records
come from the fictional fixtures in [`dev/clean/tools/seed.php`](../../dev/clean/tools/seed.php);
the administrator is the clean installer's test account. The appearance preview uses the module's
own sample rows. No production/customer data or cloud account screenshots are included.

| Image | Origin and scope |
|---|---|
| `organization-list.png` | Accepted clean-instance list capture, `V03-list`; header, favourites and list toolbar. |
| `module-menu.png` | Accepted clean-instance menu capture, `V02-menu`; the open menu panel. |
| `appearance.png` | Accepted clean-instance settings capture, `V10-frame`; appearance controls and preview. |
| `menu-editor.png` | Accepted clean-instance settings capture, `V10-menu`; groups and module tiles. |
| `record-details.png` | Clean-instance browser capture during 1.0.0 release acceptance; organization details in a window over the list. |
| `record-edit.png` | Clean-instance browser capture during 1.0.0 release acceptance; the same fictional organization in its edit window. |

The first four files are byte-for-byte copies of the corresponding images under
[`tests/visual/accepted`](../../tests/visual/accepted/README.md). Their appearance was checked again
during [1.0.0 release acceptance](../release.md). The two full-page record captures are also
unmodified. PNGs contain no browser chrome, address bar, cookies or credentials; the record
captures include only a standard colour profile as metadata.

Keep this gallery separate from the visual regression baseline. For future updates, capture the
real theme on a clean installation with synthetic data, check every visible value and PNG metadata,
and preserve the original UI. Do not substitute generated mockups or customer screenshots.
Restore preferences after a capture if they were changed. The source archive includes these
images through `packaging/source-allowlist.txt`; they are not shipped in the installable CRM module.
