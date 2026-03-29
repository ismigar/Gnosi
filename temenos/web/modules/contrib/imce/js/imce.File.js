/*global imce:true*/
(function ($, Drupal, imce) {
  'use strict';

  /**
   * @file
   * Defines imce File object.
   */

  /**
   * File.
   */
  imce.File = function (name) {
    this.construct(name);
  };

  /**
   * Item prototype
   */
  var ItemProto = imce.Item.prototype;

  /**
   * File prototype extends Item prototype.
   */
  var File = $.extend(imce.File.prototype, ItemProto);

  /**
   * Initialize the file object.
   */
  File.construct = function (name) {
    this.isFile = true;
    this.type = 'file';
    ItemProto.construct.apply(this, arguments);
  };

  /**
   * Initialize DOM elements.
   */
  File.createEl = function () {
    if (!this.el) {
      ItemProto.createEl.apply(this, arguments);
      this.el.className += ' file';
    }
  };

  /**
   * Name change handler.
   */
  File.onNameChange = function (oldval) {
    ItemProto.onNameChange.apply(this, arguments);
    // Get the new extension
    var File = this;
    var newext = imce.getExt(File.name);
    // Check if the extension has changed
    if (File.ext !== newext) {
      // Remove the classname of old ext
      if (File.ext != null) {
        if (File.ext) {
          $(File.el).removeClass('file-' + File.ext.toLowerCase());
        }
      }
      // Add the classname for new ext
      if (newext) {
        File.el.className += ' file-' + newext.toLowerCase();
      }
      File.ext = newext;
    }
  };

  /**
   * Check if the file can be used as an image source.
   */
  File.isImageSource = function () {
    if (this.width) {
      return true;
    }
    // Allow svg files to be previewed without dimensions.
    if ((this.ext || '').toLowerCase() === 'svg') {
      return true;
    }
    // Width might be missing because of lazy dimensions.
    return imce.getConf('lazy_dimensions') && this.hasImageExtension();
  };

  /**
   * Check if the file name has image extension.
   */
  File.hasImageExtension = function () {
    return imce.hasImageExtension(this.name);
  };

})(jQuery, Drupal, imce);
