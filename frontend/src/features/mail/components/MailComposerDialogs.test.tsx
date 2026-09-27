import {act} from 'react';
import {expect, it, vi} from 'vitest';
import {mountTestComponent} from '../../../../tests/mount-react';
import {MailComposerDialogs} from './MailComposerDialogs';
import type {MailComposerController} from './useMailComposerController';

it('focuses Cancel, contains Tab in both directions and returns to the composer', () => {
 const opener=document.createElement('button');document.body.append(opener);opener.focus();
 const close=vi.fn(), save=vi.fn(), setConfirm=vi.fn();
 const controller={showCloseConfirm:true,handleSaveAndClose:save,onClose:close,setShowCloseConfirm:setConfirm,t:(key:string)=>key} as unknown as MailComposerController;
 const view=mountTestComponent(<MailComposerDialogs controller={controller}/>);
 try {
  const buttons=view.container.querySelectorAll('button');const first=buttons[0],cancel=buttons[2];
  if(!first || !cancel)throw new Error('Missing dialog buttons');
  expect(document.activeElement).toBe(cancel);
  const key=(name:string,shiftKey=false)=>{const event=new KeyboardEvent('keydown',{key:name,shiftKey,bubbles:true,cancelable:true});act(()=>{document.activeElement?.dispatchEvent(event);});return event;};
  key('Tab');expect(document.activeElement).toBe(first);key('Tab',true);expect(document.activeElement).toBe(cancel);
  expect(key('Enter').defaultPrevented).toBe(false);expect(save).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
  key('Escape');expect(setConfirm).toHaveBeenCalledExactlyOnceWith(false);
  view.render(<MailComposerDialogs controller={{...controller,showCloseConfirm:false}}/>);expect(document.activeElement).toBe(opener);
 }finally{view.unmount();opener.remove();}
});
