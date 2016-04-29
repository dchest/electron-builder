import { PlatformPackager, BuildInfo, normalizeTargets } from "./platformPackager"
import { Platform, OsXBuildOptions } from "./metadata"
import * as path from "path"
import { Promise as BluebirdPromise } from "bluebird"
import { log, debug, spawn, statOrNull } from "./util"
import { createKeychain, deleteKeychain, CodeSigningInfo, generateKeychainName } from "./codeSign"
import { path7za } from "7zip-bin"
import deepAssign = require("deep-assign")
import { sign, flat, BaseSignOptions } from "electron-osx-sign-tf"

//noinspection JSUnusedLocalSymbols
const __awaiter = require("./awaiter")

export default class OsXPackager extends PlatformPackager<OsXBuildOptions> {
  codeSigningInfo: Promise<CodeSigningInfo>

  readonly targets: Array<string>

  constructor(info: BuildInfo, cleanupTasks: Array<() => Promise<any>>) {
    super(info)

    if (this.options.cscLink != null && this.options.cscKeyPassword != null) {
      const keychainName = generateKeychainName()
      cleanupTasks.push(() => deleteKeychain(keychainName))
      this.codeSigningInfo = createKeychain(keychainName, this.options.cscLink, this.options.cscKeyPassword, this.options.cscInstallerLink, this.options.cscInstallerKeyPassword, this.options.csaLink)
    }
    else {
      this.codeSigningInfo = BluebirdPromise.resolve(null)
    }

    const targets = normalizeTargets(this.customBuildOptions == null ? null : this.customBuildOptions.target)
    if (targets != null) {
      for (let target of targets) {
        if (target !== "default" && target !== "dmg" && target !== "zip" && target !== "mas" && target !== "7z") {
          throw new Error("Unknown target: " + target)
        }
      }
    }
    this.targets = targets == null ? ["default"] : targets
  }

  get platform() {
    return Platform.OSX
  }

  async pack(outDir: string, arch: string, postAsyncTasks: Array<Promise<any>>): Promise<any> {
    const packOptions = this.computePackOptions(outDir, arch)
    let nonMasPromise: Promise<any> = null
    if (this.targets.length > 1 || this.targets[0] !== "mas") {
      const appOutDir = this.computeAppOutDir(outDir, arch)
      nonMasPromise = this.doPack(packOptions, outDir, appOutDir, arch)
        .then(() => this.sign(appOutDir, false))
        .then(() => postAsyncTasks.push(this.packageInDistributableFormat(outDir, appOutDir, arch)))
    }

    if (this.targets.includes("mas")) {
      // osx-sign - disable warning
      const appOutDir = path.join(outDir, `${this.appName}-mas-${arch}`)
      await this.doPack(Object.assign({}, packOptions, {platform: "mas", "osx-sign": false}), outDir, appOutDir, arch)
      await this.sign(appOutDir, true)
    }

    if (nonMasPromise != null) {
      await nonMasPromise
    }
  }

  private async sign(appOutDir: string, isMas: boolean): Promise<any> {
    let codeSigningInfo = await this.codeSigningInfo
    if (codeSigningInfo == null) {
      codeSigningInfo = {
        name: this.options.sign || process.env.CSC_NAME,
        installerName: this.options.sign || process.env.CSC_INSTALLER_NAME,
      }
    }

    if (codeSigningInfo.name == null) {
      log("App is not signed: CSC_LINK or CSC_NAME are not specified")
      return
    }

    log("Signing app")

    const baseSignOptions: BaseSignOptions = {
      app: path.join(appOutDir, this.appName + ".app"),
      platform: isMas ? "mas" : "darwin"
    }
    if (codeSigningInfo.keychainName != null) {
      baseSignOptions.keychain = codeSigningInfo.keychainName
    }

    await BluebirdPromise.promisify(sign)(Object.assign({
      identity: codeSigningInfo.name,
    }, (<any>this.devMetadata.build)["osx-sign"], baseSignOptions))

    if (isMas) {
      const installerIdentity = codeSigningInfo.installerName
      if (installerIdentity == null) {
        throw new Error("Signing is required for mas builds but CSC_INSTALLER_LINK or CSC_INSTALLER_NAME are not specified")
      }

      const pkg = path.join(appOutDir, `${this.appName}-${this.metadata.version}.pkg`)
      await BluebirdPromise.promisify(flat)(Object.assign({
        pkg: pkg,
        identity: installerIdentity,
      }, baseSignOptions))
      this.dispatchArtifactCreated(pkg, `${this.metadata.name}-${this.metadata.version}.pkg`)
    }
  }

  protected async computeEffectiveDistOptions(appOutDir: string): Promise<appdmg.Specification> {
    const specification: appdmg.Specification = deepAssign({
      title: this.appName,
      icon: path.join(this.buildResourcesDir, "icon.icns"),
      "icon-size": 80,
      contents: [
        {
          "x": 410, "y": 220, "type": "link", "path": "/Applications"
        },
        {
          "x": 130, "y": 220, "type": "file"
        }
      ]
    }, this.customBuildOptions)

    if (this.customBuildOptions == null || !("background" in this.customBuildOptions)) {
      const background = path.join(this.buildResourcesDir, "background.png")
      const info = await statOrNull(background)
      if (info != null && info.isFile()) {
        specification.background = background
      }
    }

    specification.contents[1].path = path.join(appOutDir, this.appName + ".app")
    return specification
  }

  packageInDistributableFormat(outDir: string, appOutDir: string, arch: string): Promise<any> {
    const promises: Array<Promise<any>> = []

    if (this.targets.includes("dmg") || this.targets.includes("default")) {
      const artifactPath = path.join(appOutDir, `${this.appName}-${this.metadata.version}.dmg`)
      promises.push(new BluebirdPromise<any>(async(resolve, reject) => {
        log("Creating DMG")
        const dmgOptions = {
          target: artifactPath,
          basepath: this.projectDir,
          specification: await this.computeEffectiveDistOptions(appOutDir),
          compression: this.devMetadata.build.compression === "store" ? "NONE" : "UDBZ"
        }

        if (debug.enabled) {
          debug(`appdmg: ${JSON.stringify(dmgOptions, null, 2)}`)
        }

        const emitter = require("appdmg-tf")(dmgOptions)
        emitter.on("error", reject)
        emitter.on("finish", () => resolve())
        if (debug.enabled) {
          emitter.on("progress", (info: any) => {
            if (info.type === "step-begin") {
              debug(`appdmg: [${info.current}] ${info.title}`)
            }
          })
        }
      })
        .then(() => this.dispatchArtifactCreated(artifactPath, `${this.metadata.name}-${this.metadata.version}.dmg`)))
    }

    for (let target of this.targets) {
      if (target !== "mas" && target !== "dmg") {
        const format = target === "default" ? "zip" : target
        log("Creating OS X " + format)
        // for default we use mac to be compatible with Squirrel.Mac
        const classifier = target === "default" ? "mac" : "osx"
        promises.push(this.archiveApp(appOutDir, format, classifier)
          .then(it => this.dispatchArtifactCreated(it, `${this.metadata.name}-${this.metadata.version}-${classifier}.${format}`)))
      }
    }
    return BluebirdPromise.all(promises)
  }

  private archiveApp(outDir: string, format: string, classifier: string): Promise<string> {
    const args = ["a", "-bb" + (debug.enabled ? "3" : "0"), "-bd"]
    const compression = this.devMetadata.build.compression
    const storeOnly = compression === "store"
    if (format === "zip" || storeOnly) {
      args.push("-mm=" + (storeOnly ? "Copy" : "Deflate"))
    }
    if (compression === "maximum") {
      // http://superuser.com/a/742034
      //noinspection SpellCheckingInspection
      args.push("-mfb=258", "-mpass=15")
    }

    // we use app name here - see https://github.com/electron-userland/electron-builder/pull/204
    const resultPath = `${this.appName}-${this.metadata.version}-${classifier}.${format}`
    args.push(resultPath, this.appName + ".app")

    return spawn(path7za, args, {
      cwd: outDir,
      stdio: ["ignore", debug.enabled ? "inherit" : "ignore", "inherit"],
    })
      .thenReturn(path.join(outDir, resultPath))
  }
}