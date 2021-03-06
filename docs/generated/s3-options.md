<!-- FILE IS AUTOGENERATED. Please edit S3Options class jsdoc in the packages/builder-util-runtime/src/publishOptions.ts -->

<!-- do not edit. start of generated block -->
* **<code id="S3Options-provider">provider</code>** "s3" - The provider. Must be `s3`.
* **<code id="S3Options-bucket">bucket</code>** String - The bucket name.
* <code id="S3Options-region">region</code> String - The region. Is determined and set automatically when publishing.
* <code id="S3Options-acl">acl</code> = `public-read` "private" | "public-read" - The ACL. Set to `null` to not [add](https://github.com/electron-userland/electron-builder/issues/1822).
  
  Please see [required permissions for the S3 provider](https://github.com/electron-userland/electron-builder/issues/1618#issuecomment-314679128).
* <code id="S3Options-storageClass">storageClass</code> = `STANDARD` "STANDARD" | "REDUCED_REDUNDANCY" | "STANDARD_IA" - The type of storage to use for the object.
* <code id="S3Options-channel">channel</code> = `latest` String - The update channel.
* <code id="S3Options-path">path</code> = `/` String - The directory path.
<!-- end of generated block -->