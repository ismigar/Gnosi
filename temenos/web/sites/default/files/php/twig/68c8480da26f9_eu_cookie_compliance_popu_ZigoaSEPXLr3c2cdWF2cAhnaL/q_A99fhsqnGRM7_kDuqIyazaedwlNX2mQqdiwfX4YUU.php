<?php

use Twig\Environment;
use Twig\Error\LoaderError;
use Twig\Error\RuntimeError;
use Twig\Extension\CoreExtension;
use Twig\Extension\SandboxExtension;
use Twig\Markup;
use Twig\Sandbox\SecurityError;
use Twig\Sandbox\SecurityNotAllowedTagError;
use Twig\Sandbox\SecurityNotAllowedFilterError;
use Twig\Sandbox\SecurityNotAllowedFunctionError;
use Twig\Source;
use Twig\Template;
use Twig\TemplateWrapper;

/* modules/contrib/eu_cookie_compliance/templates/eu_cookie_compliance_popup_info.html.twig */
class __TwigTemplate_5583fba584fe7ac6273ef944015cb74e extends Template
{
    private Source $source;
    /**
     * @var array<string, Template>
     */
    private array $macros = [];

    public function __construct(Environment $env)
    {
        parent::__construct($env);

        $this->source = $this->getSourceContext();

        $this->parent = false;

        $this->blocks = [
        ];
        $this->sandbox = $this->extensions[SandboxExtension::class];
        $this->checkSecurity();
    }

    protected function doDisplay(array $context, array $blocks = []): iterable
    {
        $macros = $this->macros;
        // line 40
        yield "
";
        // line 41
        if (($context["privacy_settings_tab_label"] ?? null)) {
            // line 42
            yield "  <button type=\"button\" class=\"eu-cookie-withdraw-tab\">";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["privacy_settings_tab_label"] ?? null), "html", null, true);
            yield "</button>
";
        }
        // line 44
        $context["classes"] = ["eu-cookie-compliance-banner", "eu-cookie-compliance-banner-info", ("eu-cookie-compliance-banner--" . \Drupal\Component\Utility\Html::getClass(        // line 47
($context["method"] ?? null)))];
        // line 49
        yield "<div aria-labelledby=\"popup-text\" ";
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["attributes"] ?? null), "addClass", [($context["classes"] ?? null)], "method", false, false, true, 49), "html", null, true);
        yield ">
  <div class=\"popup-content info eu-cookie-compliance-content\">
    ";
        // line 51
        if (($context["close_button_enabled"] ?? null)) {
            // line 52
            yield "      <button class=\"eu-cookie-compliance-close-button\">Close</button>
    ";
        }
        // line 54
        yield "    <div id=\"popup-text\" class=\"eu-cookie-compliance-message\" role=\"document\">
      ";
        // line 55
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["message"] ?? null), "html", null, true);
        yield "
      ";
        // line 56
        if (($context["more_info_button"] ?? null)) {
            // line 57
            yield "        <button type=\"button\" class=\"find-more-button eu-cookie-compliance-more-button\">";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["more_info_button"] ?? null), "html", null, true);
            yield "</button>
      ";
        }
        // line 59
        yield "    </div>

    ";
        // line 61
        if (($context["cookie_categories"] ?? null)) {
            // line 62
            yield "      <div id=\"eu-cookie-compliance-categories\" class=\"eu-cookie-compliance-categories\">
        ";
            // line 63
            $context['_parent'] = $context;
            $context['_seq'] = CoreExtension::ensureTraversable(($context["cookie_categories"] ?? null));
            foreach ($context['_seq'] as $context["key"] => $context["category"]) {
                // line 64
                yield "          <div class=\"eu-cookie-compliance-category\">
            <div>
              <input type=\"checkbox\" name=\"cookie-categories\" class=\"eu-cookie-compliance-category-checkbox\" id=\"cookie-category-";
                // line 66
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, $context["key"], "html", null, true);
                yield "\"
                     value=\"";
                // line 67
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, $context["key"], "html", null, true);
                yield "\"
                     ";
                // line 68
                if (CoreExtension::inFilter(CoreExtension::getAttribute($this->env, $this->source, $context["category"], "checkbox_default_state", [], "any", false, false, true, 68), ["checked", "required"])) {
                    yield " checked ";
                }
                // line 69
                yield "                     ";
                if ((CoreExtension::getAttribute($this->env, $this->source, $context["category"], "checkbox_default_state", [], "any", false, false, true, 69) == "required")) {
                    yield " disabled ";
                }
                yield " >
              <label for=\"cookie-category-";
                // line 70
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, $context["key"], "html", null, true);
                yield "\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["category"], "label", [], "any", false, false, true, 70), "html", null, true);
                yield "</label>
            </div>
            ";
                // line 72
                if (CoreExtension::getAttribute($this->env, $this->source, $context["category"], "description", [], "any", false, false, true, 72)) {
                    // line 73
                    yield "              <div class=\"eu-cookie-compliance-category-description\">";
                    yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["category"], "description", [], "any", false, false, true, 73), "html", null, true);
                    yield "</div>
            ";
                }
                // line 75
                yield "          </div>
        ";
            }
            $_parent = $context['_parent'];
            unset($context['_seq'], $context['key'], $context['category'], $context['_parent']);
            $context = array_intersect_key($context, $_parent) + $_parent;
            // line 77
            yield "        ";
            if (($context["save_preferences_button_label"] ?? null)) {
                // line 78
                yield "          <div class=\"eu-cookie-compliance-categories-buttons\">
            <button type=\"button\"
                    class=\"eu-cookie-compliance-save-preferences-button ";
                // line 80
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["olivero_secondary_button_classes"] ?? null), "html", null, true);
                yield "\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["save_preferences_button_label"] ?? null), "html", null, true);
                yield "</button>
          </div>
        ";
            }
            // line 83
            yield "      </div>
    ";
        }
        // line 85
        yield "
    <div id=\"popup-buttons\" class=\"eu-cookie-compliance-buttons";
        // line 86
        if (($context["cookie_categories"] ?? null)) {
            yield " eu-cookie-compliance-has-categories";
        }
        yield "\">
      ";
        // line 87
        if (($context["tertiary_button_label"] ?? null)) {
            // line 88
            yield "        <button type=\"button\" class=\"";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["tertiary_button_class"] ?? null), "html", null, true);
            yield "\">";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["tertiary_button_label"] ?? null), "html", null, true);
            yield "</button>
      ";
        }
        // line 90
        yield "      <button type=\"button\" class=\"";
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["primary_button_class"] ?? null), "html", null, true);
        yield "\">";
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["agree_button"] ?? null), "html", null, true);
        yield "</button>
      ";
        // line 91
        if (($context["secondary_button_label"] ?? null)) {
            // line 92
            yield "        <button type=\"button\" class=\"";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["secondary_button_class"] ?? null), "html", null, true);
            yield "\">";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["secondary_button_label"] ?? null), "html", null, true);
            yield "</button>
      ";
        }
        // line 94
        yield "    </div>
  </div>
</div>
";
        $this->env->getExtension('\Drupal\Core\Template\TwigExtension')
            ->checkDeprecations($context, ["privacy_settings_tab_label", "method", "attributes", "close_button_enabled", "message", "more_info_button", "cookie_categories", "save_preferences_button_label", "olivero_secondary_button_classes", "tertiary_button_label", "tertiary_button_class", "primary_button_class", "agree_button", "secondary_button_label", "secondary_button_class"]);        yield from [];
    }

    /**
     * @codeCoverageIgnore
     */
    public function getTemplateName(): string
    {
        return "modules/contrib/eu_cookie_compliance/templates/eu_cookie_compliance_popup_info.html.twig";
    }

    /**
     * @codeCoverageIgnore
     */
    public function isTraitable(): bool
    {
        return false;
    }

    /**
     * @codeCoverageIgnore
     */
    public function getDebugInfo(): array
    {
        return array (  198 => 94,  190 => 92,  188 => 91,  181 => 90,  173 => 88,  171 => 87,  165 => 86,  162 => 85,  158 => 83,  150 => 80,  146 => 78,  143 => 77,  136 => 75,  130 => 73,  128 => 72,  121 => 70,  114 => 69,  110 => 68,  106 => 67,  102 => 66,  98 => 64,  94 => 63,  91 => 62,  89 => 61,  85 => 59,  79 => 57,  77 => 56,  73 => 55,  70 => 54,  66 => 52,  64 => 51,  58 => 49,  56 => 47,  55 => 44,  49 => 42,  47 => 41,  44 => 40,);
    }

    public function getSourceContext(): Source
    {
        return new Source("", "modules/contrib/eu_cookie_compliance/templates/eu_cookie_compliance_popup_info.html.twig", "/home/ismigar/webapps/web/web/modules/contrib/eu_cookie_compliance/templates/eu_cookie_compliance_popup_info.html.twig");
    }
    
    public function checkSecurity()
    {
        static $tags = ["if" => 41, "set" => 44, "for" => 63];
        static $filters = ["escape" => 42, "clean_class" => 47];
        static $functions = [];

        try {
            $this->sandbox->checkSecurity(
                ['if', 'set', 'for'],
                ['escape', 'clean_class'],
                [],
                $this->source
            );
        } catch (SecurityError $e) {
            $e->setSourceContext($this->source);

            if ($e instanceof SecurityNotAllowedTagError && isset($tags[$e->getTagName()])) {
                $e->setTemplateLine($tags[$e->getTagName()]);
            } elseif ($e instanceof SecurityNotAllowedFilterError && isset($filters[$e->getFilterName()])) {
                $e->setTemplateLine($filters[$e->getFilterName()]);
            } elseif ($e instanceof SecurityNotAllowedFunctionError && isset($functions[$e->getFunctionName()])) {
                $e->setTemplateLine($functions[$e->getFunctionName()]);
            }

            throw $e;
        }

    }
}
