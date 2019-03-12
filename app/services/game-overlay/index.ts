import electron from 'electron';
import { fromEvent, Subject, Subscription } from 'rxjs';
import overlay, { OverlayId } from '@streamlabs/game-overlay';
import { delay, take } from 'rxjs/operators';
import { Inject } from 'util/injector';
import { InitAfter } from 'util/service-observer';
import { Service } from '../service';
import { UserService } from 'services/user';
import { CustomizationService } from 'services/customization';
import { getPlatformService } from '../platforms';
import { WindowsService } from '../windows';

const { BrowserWindow, BrowserView, getGlobal } = electron.remote;

/**
 * We need to show the windows so the overlay system can capture its contents.
 * Workaround is to render them offscreen via positioning.
 */
const OFFSCREEN_OFFSET = 0; // 5000;

@InitAfter('UserService')
@InitAfter('WindowService')
export class GameOverlayService extends Service {
  @Inject() userService: UserService;
  @Inject() customizationService: CustomizationService;
  @Inject() windowsService: WindowsService;

  userLoginSubscription: Subscription;
  userLogoutSubscription: Subscription;
  windows: Dictionary<Electron.BrowserWindow> = {};
  overlayWindow: Electron.BrowserWindow;
  onWindowsReady: Subject<Electron.BrowserWindow> = new Subject<Electron.BrowserWindow>();
  onWindowsReady2: Subject<Electron.BrowserWindow> = new Subject<Electron.BrowserWindow>();
  isShowing = false;

  init() {
    console.log('initializing overlays');
    super.init();

    this.onWindowsReady
      .pipe(
        take(3),
        delay(5000), // so recent events has time to load
      )
      .subscribe({
        complete: () => {
          Object.values(this.windows).forEach(win => {
            // win.showInactive();
            win.show();

            const overlayId = overlay.addHWND(win.getNativeWindowHandle());

            if (overlayId === '-1') {
              this.overlayWindow.hide();
              throw new Error('Error creating overlay');
            }

            const [x, y] = win.getPosition();
            const { width, height } = win.getBounds();

            overlay.setPosition(overlayId, x - OFFSCREEN_OFFSET, y, width, height);
            // @ts-ignore: update types
            overlay.setTransparency(overlayId, 255);
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
    overlay.start();

    const display = this.windowsService.getCurrentDisplay();

    const [containerX, containerY] = [
      display.workArea.width / 2 + 200,
      display.workArea.height / 2 - 300,
    ];

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

    this.overlayWindow = new BrowserWindow({
      ...commonWindowOptions,
      height: 600,
      width: 600,
      x: containerX,
      y: containerY,
    });

    const commonBrowserViewOptions = {
      webPreferences: {
        nodeIntegration: false,
      },
    };

    this.windows.recentEvents = new BrowserWindow({
      ...commonWindowOptions,
      width: 600,
      x: containerX - 600 + OFFSCREEN_OFFSET,
      y: containerY,
      parent: this.overlayWindow,
    });

    this.windows.chat = new BrowserWindow({
      ...commonWindowOptions,
      x: containerX + OFFSCREEN_OFFSET,
      y: containerY,
      height: 600,
      parent: this.overlayWindow,
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
      view.setAutoResize({ width: true, height: true });
    });

    recentEventsBrowserView.setBounds({ x: 0, y: 0, width: 600, height: 300 });
    chatBrowserView.setBounds({ x: 0, y: 0, width: 300, height: 600 });

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

    this.windows.overlayControls = this.windowsService.createOneOffWindowForOverlay(
      {
        ...commonWindowOptions,
        // @ts-ignore
        webPreferences: {},
        parent: this.overlayWindow,
        x: containerX - 600 + OFFSCREEN_OFFSET,
        y: containerY + 300,
        width: 600,
        height: 300,
        // OneOffWindow options
        isFullScreen: true,
        componentName: 'OverlayWindow',
      },
      'overlay',
    );

    // Listen for the second dom-ready as we trigger a reload as a workaround for a blank screen
    fromEvent(this.windows.overlayControls.webContents, 'dom-ready')
      .pipe(take(2))
      .subscribe({
        complete: () => this.onWindowsReady.next(this.windows.overlayControls),
      });

    this.windows.overlayControls.webContents.once('dom-ready', () => {
      this.windows.overlayControls.reload();
    });
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
