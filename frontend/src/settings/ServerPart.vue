<script setup lang="ts">
/**
 * A part of the server page shown inside the editor (docs/architecture.md §7.13): the status, the switches of the
 * server, the recovery and the check of this browser are plain HTML forms printed by Index.tpl, so they work without
 * JavaScript and with "&editor=off". While the editor is mounted, the node is moved into its "Service" section (the
 * same node: its forms, CSRF fields and the island of the check keep working); when the editor goes away it is put
 * back where the server printed it.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{ selector: string }>()
const host = ref<HTMLElement | null>(null)
let node: HTMLElement | null = null
let marker: Comment | null = null

onMounted(() => {
  node = document.querySelector<HTMLElement>(props.selector)
  if (node === null || host.value === null) {
    return
  }
  marker = document.createComment('modernui server part')
  node.before(marker)
  host.value.append(node)
  node.classList.add('mu-server-part--adopted')
})

onBeforeUnmount(() => {
  if (node !== null && marker !== null) {
    node.classList.remove('mu-server-part--adopted')
    marker.replaceWith(node)
  }
  node = null
  marker = null
})
</script>

<template>
  <div ref="host" class="mu-server-host"></div>
</template>
