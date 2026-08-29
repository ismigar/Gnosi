import { FilesystemPickerModal } from '../../FilesystemPickerModal';
import type { InsertContentController } from './useInsertContentController';


interface InsertContentPickersProps {
    readonly modal: InsertContentController;
}


export function InsertContentPickers({ modal }: InsertContentPickersProps) {
    return (
        <>
            <FilesystemPickerModal
                initialQuery={modal.state.uploadFile?.name || ''}
                isOpen={modal.state.pickerOpen}
                mode="any"
                onClose={modal.actions.closePicker}
                onSelect={modal.actions.selectLocal}
                onSelectMany={modal.actions.selectLocalMany}
            />
            <FilesystemPickerModal
                isOpen={modal.destinationPickerOpen}
                mode="folder"
                onClose={modal.actions.cancelDestination}
                onSelect={(path) => {
                    modal.actions.selectDestination(path);
                }}
            />
        </>
    );
}
