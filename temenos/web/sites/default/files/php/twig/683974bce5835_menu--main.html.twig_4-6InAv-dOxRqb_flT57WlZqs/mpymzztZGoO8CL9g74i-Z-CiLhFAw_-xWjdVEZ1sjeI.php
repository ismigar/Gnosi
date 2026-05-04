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

/* themes/custom/elraco/templates/menu--main.html.twig */
class __TwigTemplate_dfe11d656e8f5d8c75b7e725c053857c extends Template
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
        // line 10
        yield "
";
        // line 12
        yield "<div class=\"navbar\">
  <div class=\"navbar-heades\">
    <button type=\"button\" class=\"navbar-toggle\" data-toggle=\"collapse\" data-target=\".navbar-collapse\">
      <span class=\"icon-bar\"></span>
      <span class=\"icon-bar\"></span>
      <span class=\"icon-bar\"></span>
    </button>
    <div class=\"collapse navbar-collapse\">
      ";
        // line 20
        $macros["menus"] = $this->macros["menus"] = $this;
        // line 21
        yield "      ";
        // line 25
        yield "      ";
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar($macros["menus"]->getTemplateForMacro("macro_menu_links", $context, 25, $this->getSourceContext())->macro_menu_links(...[($context["items"] ?? null), ($context["attributes"] ?? null), 0]));
        yield "

      ";
        // line 55
        yield "
    </div>
  </div>
</div>
";
        $this->env->getExtension('\Drupal\Core\Template\TwigExtension')
            ->checkDeprecations($context, ["_self", "items", "attributes", "menu_level"]);        yield from [];
    }

    // line 27
    public function macro_menu_links($items = null, $attributes = null, $menu_level = null, ...$varargs): string|Markup
    {
        $macros = $this->macros;
        $context = [
            "items" => $items,
            "attributes" => $attributes,
            "menu_level" => $menu_level,
            "varargs" => $varargs,
        ] + $this->env->getGlobals();

        $blocks = [];

        return ('' === $tmp = \Twig\Extension\CoreExtension::captureOutput((function () use (&$context, $macros, $blocks) {
            // line 28
            yield "        ";
            $macros["menus"] = $this;
            // line 29
            yield "        ";
            if (($context["items"] ?? null)) {
                // line 30
                yield "          ";
                if ((($context["menu_level"] ?? null) == 0)) {
                    // line 31
                    yield "            <ul class=\"nav navbar-nav\" role=\"menu\" aria-labelledby=\"dropdownMenu\">
          ";
                } else {
                    // line 33
                    yield "            <ul class=\"dropdown-menu\" role=\"menu\" aria-labelledby=\"dLabel\">
          ";
                }
                // line 35
                yield "          ";
                $context['_parent'] = $context;
                $context['_seq'] = CoreExtension::ensureTraversable(($context["items"] ?? null));
                foreach ($context['_seq'] as $context["_key"] => $context["item"]) {
                    // line 36
                    yield "            ";
                    if (CoreExtension::getAttribute($this->env, $this->source, $context["item"], "below", [], "any", false, false, true, 36)) {
                        // line 37
                        yield "              ";
                        if ((($context["menu_level"] ?? null) == 0)) {
                            // line 38
                            yield "                <li class=\"dropdown\">
                  <a href=\"";
                            // line 39
                            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["item"], "url", [], "any", false, false, true, 39), "html", null, true);
                            yield "\" class=\"dropdown-toggle\">";
                            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["item"], "title", [], "any", false, false, true, 39), "html", null, true);
                            yield " <span class=\"caret\"></span></a>
                  ";
                            // line 40
                            yield $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar($macros["menus"]->getTemplateForMacro("macro_menu_links", $context, 40, $this->getSourceContext())->macro_menu_links(...[CoreExtension::getAttribute($this->env, $this->source, $context["item"], "below", [], "any", false, false, true, 40), ($context["attributes"] ?? null), (($context["menu_level"] ?? null) + 1)]));
                            yield "
                </li>
              ";
                        } else {
                            // line 43
                            yield "                <li class=\"dropdown-submenu\">
                  <a href=\"";
                            // line 44
                            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["item"], "url", [], "any", false, false, true, 44), "html", null, true);
                            yield "\">";
                            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["item"], "title", [], "any", false, false, true, 44), "html", null, true);
                            yield "</a>
                  ";
                            // line 45
                            yield $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar($macros["menus"]->getTemplateForMacro("macro_menu_links", $context, 45, $this->getSourceContext())->macro_menu_links(...[CoreExtension::getAttribute($this->env, $this->source, $context["item"], "below", [], "any", false, false, true, 45), ($context["attributes"] ?? null), (($context["menu_level"] ?? null) + 1)]));
                            yield "
                </li>
              ";
                        }
                        // line 48
                        yield "            ";
                    } else {
                        // line 49
                        yield "              <li ";
                        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["item"], "attributes", [], "any", false, false, true, 49), "html", null, true);
                        yield ">";
                        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, $this->extensions['Drupal\Core\Template\TwigExtension']->getLink(CoreExtension::getAttribute($this->env, $this->source, $context["item"], "title", [], "any", false, false, true, 49), CoreExtension::getAttribute($this->env, $this->source, $context["item"], "url", [], "any", false, false, true, 49)), "html", null, true);
                        yield "</li>
            ";
                    }
                    // line 51
                    yield "          ";
                }
                $_parent = $context['_parent'];
                unset($context['_seq'], $context['_key'], $context['item'], $context['_parent']);
                $context = array_intersect_key($context, $_parent) + $_parent;
                // line 52
                yield "          </ul>
        ";
            }
            // line 54
            yield "      ";
            yield from [];
        })())) ? '' : new Markup($tmp, $this->env->getCharset());
    }

    /**
     * @codeCoverageIgnore
     */
    public function getTemplateName(): string
    {
        return "themes/custom/elraco/templates/menu--main.html.twig";
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
        return array (  170 => 54,  166 => 52,  160 => 51,  152 => 49,  149 => 48,  143 => 45,  137 => 44,  134 => 43,  128 => 40,  122 => 39,  119 => 38,  116 => 37,  113 => 36,  108 => 35,  104 => 33,  100 => 31,  97 => 30,  94 => 29,  91 => 28,  77 => 27,  67 => 55,  61 => 25,  59 => 21,  57 => 20,  47 => 12,  44 => 10,);
    }

    public function getSourceContext(): Source
    {
        return new Source("", "themes/custom/elraco/templates/menu--main.html.twig", "/home/ismigar/webapps/web/web/themes/custom/elraco/templates/menu--main.html.twig");
    }
    
    public function checkSecurity()
    {
        static $tags = ["import" => 20, "macro" => 27, "if" => 29, "for" => 35];
        static $filters = ["escape" => 39];
        static $functions = ["link" => 49];

        try {
            $this->sandbox->checkSecurity(
                ['import', 'macro', 'if', 'for'],
                ['escape'],
                ['link'],
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
