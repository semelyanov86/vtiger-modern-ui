#!/usr/bin/env bash
# Migrations and settings storage of ModernUI against a throwaway MySQL 8.4 container (task test:db).
# Two databases: utf8mb4 (upgraded installations) and utf8 (what the installer of a clean 8.4.0 creates).
# Never touches the database of the dev instance.
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
IMAGE=${MU_TEST_MYSQL_IMAGE:-mysql:8.4}
PHP=${MU_TEST_PHP:-php8.5}
name=modernui-test-mysql-$$
docker run -d --rm --name "$name" -e MYSQL_ROOT_PASSWORD=test -p 127.0.0.1::3306 --tmpfs /var/lib/mysql \
	"$IMAGE" --sql-mode=NO_ENGINE_SUBSTITUTION >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 90); do
	if docker exec "$name" mysql -uroot -ptest -e 'SELECT 1' >/dev/null 2>&1; then
		break
	fi
	sleep 1
done
docker exec "$name" mysql -uroot -ptest -e "CREATE DATABASE mu_utf8mb4 CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci; CREATE DATABASE mu_utf8 CHARACTER SET utf8 COLLATE utf8_general_ci" 2>/dev/null
port=$(docker port "$name" 3306/tcp | head -1 | sed 's/.*://')
status=0
for database in mu_utf8mb4 mu_utf8; do
	"$PHP" "$REPO/tests/php/db/DbTest.php" 127.0.0.1 "$port" "$database" || status=1
done
exit $status
