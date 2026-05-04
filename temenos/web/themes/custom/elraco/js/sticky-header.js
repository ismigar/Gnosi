/**
 * @file
 * Sticky Header behaviors.
 */

(function ($, Drupal) {

    'use strict';

    /**
     * Toggles the .is-scrolled class on the body based on scroll position.
     */
    Drupal.behaviors.stickyHeader = {
        attach: function (context, settings) {
            // Simple scroll listener without 'once' dependency for robustness
            $(window).on('scroll', function () {
                if ($(window).scrollTop() > 50) {
                    $('body').addClass('is-scrolled');
                } else {
                    $('body').removeClass('is-scrolled');
                }
            });

            // Trigger once on load in case we start scrolled down
            if ($(window).scrollTop() > 50) {
                $('body').addClass('is-scrolled');
            }
        }
    };

})(jQuery, Drupal);
