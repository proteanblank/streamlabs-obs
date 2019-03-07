import electron from 'electron';
import { Subject, Subscription } from 'rxjs';
import overlay, { OverlayId } from '@streamlabs/game-overlay';
import { take } from 'rxjs/operators';
import { Inject } from 'util/injector';
import { InitAfter } from 'util/service-observer';
import { Service } from '../service';
import { UserService } from 'services/user';
import { CustomizationService } from 'services/customization';
import { getPlatformService } from '../platforms';
import { WindowsService } from '../windows';

const { BrowserWindow, BrowserView } = electron.remote;
const OFFSCREEN_OFFSET = 0; // 5000;

@InitAfter('UserService')
export class GameOverlayService extends Service {
  @Inject() userService: UserService;
  @Inject() customizationService: CustomizationService;
  @Inject() windowsService: WindowsService;

  overlayId: OverlayId;
  userLoginSubscription: Subscription;
  userLogoutSubscription: Subscription;
  windows: Dictionary<Electron.BrowserWindow> = {};
  mainWindow: Electron.BrowserWindow;
  onWindowsReady: Subject<Electron.BrowserWindow> = new Subject<Electron.BrowserWindow>();
  isShowing = false;

  init() {
    console.log('initializing overlays');
    super.init();

    this.onWindowsReady.pipe(take(2)).subscribe({
      complete: () => {
        Object.values(this.windows).forEach(win => {
          win.showInactive();
          // const overlayId: any = overlay.addHWND(win.getNativeWindowHandle());
          const overlayId = overlay.add('https://google.com');
          const [x, y] = win.getPosition();
          console.log('position', win.getPosition());
          overlay.setPosition(overlayId, x - OFFSCREEN_OFFSET, y, 300, 300);
          overlay.setTransparency(255);

          // @ts-ignore: waiting for updated types
          if (overlayId === '-1') {
            throw new Error('Error creating overlay');
          }
        });
      },
    });

    if (this.userService.isLoggedIn()) {
      this.createOverlay();
    }

    this.userLoginSubscription = this.userService.userLogin.subscribe(() => {
      this.createOverlay();
    });

    this.userLogoutSubscription = this.userService.userLogout.subscribe(() => {
      this.destroyOverlay();
    });

    // TODO: better way to track shutdown
    electron.ipcRenderer.once('shutdownComplete', () => {
      overlay.stop();
    });
  }

  async createOverlay() {
    console.log('creating overlay');
    overlay.start();

    const commonWindowOptions = {
      backgroundColor: this.customizationService.nightMode ? '#17242d' : '#fff',
      show: false,
      frame: false,
      width: 300,
      height: 300,
      skipTaskbar: true,
      thickFrame: false,
      webPreferences: {
        nodeIntegration: false,
      },
    };

    const commonBrowserViewOptions = {
      webPreferences: {
        nodeIntegration: false,
      },
    };

    this.windows.recentEvents = new BrowserWindow({
      ...commonWindowOptions,
      x: 20 + OFFSCREEN_OFFSET,
      y: 20,
      parent: this.windows.mainWindow,
    });

    this.windows.chat = new BrowserWindow({
      ...commonWindowOptions,
      x: 20 + OFFSCREEN_OFFSET,
      y: 320,
      parent: this.windows.mainWindow,
    });

    const recentEventsBrowserView = new BrowserView(commonBrowserViewOptions);
    const chatBrowserView = new BrowserView(commonBrowserViewOptions);

    recentEventsBrowserView.webContents.once('did-finish-load', () => {
      this.onWindowsReady.next(this.windows.recentEvents);
    });

    chatBrowserView.webContents.once('did-finish-load', () =>
      this.onWindowsReady.next(this.windows.chat),
    );

    [recentEventsBrowserView, chatBrowserView].forEach(view => {
      view.setBounds({ x: 0, y: 0, width: 300, height: 300 });
      view.setAutoResize({ width: true, height: true });
    });

    recentEventsBrowserView.webContents.loadURL(this.userService.recentEventsUrl());
    chatBrowserView.webContents.loadURL(
      await getPlatformService(this.userService.platform.type).getChatUrl(
        this.customizationService.nightMode ? 'night' : 'day',
      ),
    );

    // @ts-ignore: this is supported in our fork
    this.windows.recentEvents.addBrowserView(recentEventsBrowserView);
    // @ts-ignore: this is supported in our fork
    this.windows.chat.addBrowserView(chatBrowserView);
  }

  focusOverlayWindow() {
    this.windows.recentEvents.focus();
    this.windows.chat.focus();
  }

  blurOverlayWindow() {
    this.windows.recentEvents.blur();
    this.windows.chat.blur();
  }

  showOverlay() {
    overlay.show();
  }

  hideOverlay() {
    overlay.hide();
  }

  toggleOverlay() {
    if (this.isShowing) {
      this.isShowing = false;
      this.hideOverlay();
    } else {
      this.isShowing = true;
      this.showOverlay();
    }
  }

  // FIXME: this should also be invoked on destroy but we dont seem to have an opposite to mounted, init, etc
  destroyOverlay() {}
}
