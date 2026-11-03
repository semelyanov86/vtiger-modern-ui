-- The CRMs of the clean stand use the account "vtiger"; the 8.4.0 installer creates their databases itself
-- ("Create new database", CREATE DATABASE ... utf8), so the account may create databases named vtiger_*.
GRANT ALL PRIVILEGES ON `vtiger\_%`.* TO 'vtiger'@'%';
