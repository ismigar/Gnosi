/**
 * @file registers the fullscreen toolbar button and binds functionality to it.
 */

import {
  Plugin
} from 'ckeditor5/src/core';
import {
  ButtonView
} from 'ckeditor5/src/ui';
import icon from '../../../../icons/fullscreen-big.svg';
import iconCancel from '../../../../icons/fullscreen-cancel.svg';

export default class FullscreenUI extends Plugin {

  init() {
    const editor = this.editor;
    // This will register the fullscreen toolbar button.
    editor.ui.componentFactory.add('fullscreen', locale => {
      const buttonView = new ButtonView(locale);
      const editorRegion = editor.sourceElement.nextElementSibling;
      let state = 0;
      let isStickyState = false;
      // Callback executed once the image is clicked.
      buttonView.set({
        label: 'Full screen',
        icon: icon,
        tooltip: true,
      });
      buttonView.on('execute', () => {
        if (state == 1) {
          // check if the toolbar module is active
          if (document.getElementById("toolbar-administration") != null) {
            let nextSiblingElement = document.querySelector(
              ".toolbar-bar .toolbar-tab.home-toolbar-tab"
            ).nextElementSibling;
            let anchorTag = nextSiblingElement.querySelector("a");
            Drupal.toolbar.models.toolbarModel.set({
              activeTab: anchorTag,
            });
          }
          editorRegion.scrollIntoView({ block: "center" });
          editorRegion.removeAttribute("data-fullscreen");
          document.body.removeAttribute("data-fullscreen");
          buttonView.set({
            label: "Full screen",
            icon: icon,
            isOn: false,
          });
          state = 0;
          editor.focus();
          editor.ui.view.stickyPanel.isSticky = isStickyState;
        } else {
          // check if the toolbar module is active
          if (document.getElementById("toolbar-administration") != null) {
            Drupal.toolbar.models.toolbarModel.set({ activeTab: null });
          }
          // move editor into view before adding attributes
          editorRegion.scrollIntoView({block: 'center'});
          editorRegion.setAttribute('data-fullscreen', 'fullscreeneditor');
          document.body.setAttribute('data-fullscreen', 'fullscreenoverlay');
          buttonView.set({
            label: 'Mode Normal',
            icon: iconCancel,
            isOn: true,
          });
          state = 1;
          editor.focus();
          isStickyState = editor.ui.view.stickyPanel.isSticky;
          editor.ui.view.stickyPanel.isSticky = !isStickyState;
        }
      });
      return buttonView;
    });
  }
}
