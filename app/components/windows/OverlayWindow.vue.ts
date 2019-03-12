import Vue from 'vue';
import { Component } from 'vue-property-decorator';
import ModalLayout from '../ModalLayout.vue';
import { StreamInfoService } from '../../services/stream-info';
import { Inject } from '../../util/injector';
import SceneSelector from '../SceneSelector.vue';
import Display from 'components/shared/Display.vue';
import StartStreamingButton from '../StartStreamingButton.vue';

@Component({ components: { Display, ModalLayout, SceneSelector, StartStreamingButton } })
export default class OverlayWindow extends Vue {
  @Inject() streamInfoService: StreamInfoService;

  get viewerCount() {
    return this.streamInfoService.state.viewerCount.toString();
  }
}
