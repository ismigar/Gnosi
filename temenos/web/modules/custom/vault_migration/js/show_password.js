(function ($, Drupal) {
  Drupal.behaviors.showPasswordToggle = {
    attach: function (context, settings) {
      const $input = $('#edit-api-key', context);
      $input.attr('type', 'password');
      const $checkbox = $('#edit-show-api-key', context);

      if ($input.length && $checkbox.length) {
        $checkbox.on('change', function () {
          const newType = this.checked ? 'text' : 'password';
          $input.attr('type', newType);
        });
      }
    }
  };
})(jQuery, Drupal);
