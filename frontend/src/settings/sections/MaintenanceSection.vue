<script setup lang="ts">
/**
 * Service (docs/design.md §13.12): the state of the module, the immediate switches of the server, the recovery, the
 * safe mode and the check of this browser — apart from the everyday settings. They are the server forms of Index.tpl
 * (they work without JavaScript and on the page without the editor), shown here as they are (ServerPart).
 */
import { useI18n } from 'vue-i18n'
import ServerPart from '../ServerPart.vue'

const { t } = useI18n()
</script>

<template>
  <div class="mu-section" data-mu-section="maintenance">
    <p class="mu-section__intro">{{ t('editor.maintenance.intro') }}</p>
    <div class="mu-card mu-card--server">
      <ServerPart selector="[data-mu-server=&quot;service&quot;]" />
    </div>
    <p class="mu-help">
      {{ t('editor.maintenance.classic') }}
      <a href="index.php?module=ModernUI&amp;parent=Settings&amp;view=Index&amp;editor=off" data-mu-action="classic-page">{{ t('editor.compatibility.classicLink') }}</a>
    </p>
  </div>
</template>
