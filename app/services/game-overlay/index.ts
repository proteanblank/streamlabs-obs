import overlay, { OverlayId } from '@streamlabs/game-overlay';
import electron from 'electron';
import { Subject, Subscription } from 'rxjs';
import { delay, map, take } from 'rxjs/operators';
import { Inject } from 'util/injector';
import { InitAfter } from 'util/service-observer';
import { Service } from '../service';
import { UserService } from 'services/user';
import { CustomizationService } from 'services/customization';
import { getPlatformService } from '../platforms';
import { WindowsService } from '../windows';
import { tap } from 'rxjs/internal/operators/tap';

const { BrowserWindow, BrowserView } = electron.remote;

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

  init() {
    console.log('initializing overlays');
    super.init();

    this.onWindowsReady.pipe(take(2)).subscribe({
      complete: () => {
        Object.values(this.windows).forEach(win => {
          win.showInactive();
          overlay.addHWND(win.getNativeWindowHandle());
        });
        // setTimeout(() => overlay.show(), 10000);

        // overlay.show();
      },
    });

    if (this.userService.isLoggedIn()) {
      this.createOverlay();
    }
  }

  async createOverlay() {
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

    this.mainWindow = new BrowserWindow({
      ...commonWindowOptions,
      width: 300,
      height: 600,
    });
    this.windows.recentEvents = new BrowserWindow({
      ...commonWindowOptions,
      x: 20,
      y: 20,
      parent: this.windows.mainWindow,
    });

    this.windows.chat = new BrowserWindow({
      ...commonWindowOptions,
      x: 20,
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

  // FIXME: this should also be invoked on destroy but we dont seem to have an opposite to mounted, init, etc
  destroyOverlay() {}

  reloadOverlay() {}
}
