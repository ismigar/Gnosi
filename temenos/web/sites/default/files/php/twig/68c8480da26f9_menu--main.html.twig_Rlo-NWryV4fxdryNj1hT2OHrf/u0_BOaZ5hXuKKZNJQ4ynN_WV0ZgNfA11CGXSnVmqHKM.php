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

/* themes/custom/elraco/templates/navigation/menu--main.html.twig */
class __TwigTemplate_ce6a528db4a98117b3032c88ef005d8f extends Template
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
  <div class=\"navbar-header\">
    <button type=\"button\"
            class=\"navbar-toggle collapsed\"
            data-toggle=\"collapse\"
            data-target=\"#mainNav\"
            aria-controls=\"mainNav\"
            aria-expanded=\"false\"
            aria-label=\"Toggle navigation\">
      <span class=\"icon-bar\"></span>
      <span class=\"icon-bar\"></span>
      <span class=\"icon-bar\"></span>
    </button>
  </div>

  <div id=\"mainNav\" class=\"collapse navbar-collapse\" role=\"navigation\" aria-label=\"Main navigation\">
    ";
        // line 28
        $macros["menus"] = $this->macros["menus"] = $this;
        // line 29
        yield "
    ";
        // line 31
        yield "    ";
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar($macros["menus"]->getTemplateForMacro("macro_menu_links", $context, 31, $this->getSourceContext())->macro_menu_links(...[($context["items"] ?? null), ($context["attributes"] ?? null), 0]));
        yield "

    ";
        // line 70
        yield "  </div> ";
        // line 71
        yield "</div> ";
        $this->env->getExtension('\Drupal\Core\Template\TwigExtension')
            ->checkDeprecations($context, ["_self", "items", "attributes", "menu_level"]);        yield from [];
    }

    // line 33
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
            // line 34
            yield "    ";
            $macros["menus"] = $this;
            // line 35
            yield "    ";
            if (($context["items"] ?? null)) {
                // line 36
                yield "    ";
                if ((($context["menu_level"] ?? null) == 0)) {
                    // line 37
                    yield "    <ul class=\"nav navbar-nav\" role=\"menubar\">
      ";
                } else {
                    // line 39
                    yield "      <ul class=\"dropdown-menu\" role=\"menu\" aria-labelledby=\"dLabel\">
        ";
                }
                // line 41
                yield "
        ";
                // line 42
                $context['_parent'] = $context;
                $context['_seq'] = CoreExtension::ensureTraversable(($context["items"] ?? null));
                foreach ($context['_seq'] as $context["_key"] => $context["item"]) {
                    // line 43
                    yield "          ";
                    if (CoreExtension::getAttribute($this->env, $this->source, $context["item"], "below", [], "any", false, false, true, 43)) {
                        // line 44
                        yield "            ";
                        if ((($context["menu_level"] ?? null) == 0)) {
                            // line 45
                            yield "              <li class=\"dropdown\" role=\"none\">
                <a href=\"";
                            // line 46
                            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["item"], "url", [], "any", false, false, true, 46), "html", null, true);
                            yield "\"
                   class=\"dropdown-toggle\"
                   data-toggle=\"dropdown\"
                   role=\"button\"
                   aria-haspopup=\"true\"
                   aria-expanded=\"false\">
                  ";
                            // line 52
                            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["item"], "title", [], "any", false, false, true, 52), "html", null, true);
                            yield " <span class=\"caret\"></span>
                </a>
                ";
                            // line 54
                            yield $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar($macros["menus"]->getTemplateForMacro("macro_menu_links", $context, 54, $this->getSourceContext())->macro_menu_links(...[CoreExtension::getAttribute($this->env, $this->source, $context["item"], "below", [], "any", false, false, true, 54), ($context["attributes"] ?? null), (($context["menu_level"] ?? null) + 1)]));
                            yield "
              </li>
            ";
                        } else {
                            // line 57
                            yield "              <li class=\"dropdown-submenu\" role=\"none\">
                <a href=\"";
                            // line 58
                            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["item"], "url", [], "any", false, false, true, 58), "html", null, true);
                            yield "\" role=\"menuitem\">";
                            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["item"], "title", [], "any", false, false, true, 58), "html", null, true);
                            yield "</a>
                ";
                            // line 59
                            yield $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar($macros["menus"]->getTemplateForMacro("macro_menu_links", $context, 59, $this->getSourceContext())->macro_menu_links(...[CoreExtension::getAttribute($this->env, $this->source, $context["item"], "below", [], "any", false, false, true, 59), ($context["attributes"] ?? null), (($context["menu_level"] ?? null) + 1)]));
                            yield "
              </li>
            ";
                        }
                        // line 62
                        yield "          ";
                    } else {
                        // line 63
                        yield "            <li ";
                        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["item"], "attributes", [], "any", false, false, true, 63), "html", null, true);
                        yield " role=\"none\">";
                        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, $this->extensions['Drupal\Core\Template\TwigExtension']->getLink(CoreExtension::getAttribute($this->env, $this->source, $context["item"], "title", [], "any", false, false, true, 63), CoreExtension::getAttribute($this->env, $this->source, $context["item"], "url", [], "any", false, false, true, 63)), "html", null, true);
                        yield "</li>
          ";
                    }
                    // line 65
                    yield "        ";
                }
                $_parent = $context['_parent'];
                unset($context['_seq'], $context['_key'], $context['item'], $context['_parent']);
                $context = array_intersect_key($context, $_parent) + $_parent;
                // line 66
                yield "
      </ul>
      ";
            }
            // line 69
            yield "      ";
            yield from [];
        })())) ? '' : new Markup($tmp, $this->env->getCharset());
    }

    /**
     * @codeCoverageIgnore
     */
    public function getTemplateName(): string
    {
        return "themes/custom/elraco/templates/navigation/menu--main.html.twig";
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
        return array (  188 => 69,  183 => 66,  177 => 65,  169 => 63,  166 => 62,  160 => 59,  154 => 58,  151 => 57,  145 => 54,  140 => 52,  131 => 46,  128 => 45,  125 => 44,  122 => 43,  118 => 42,  115 => 41,  111 => 39,  107 => 37,  104 => 36,  101 => 35,  98 => 34,  84 => 33,  78 => 71,  76 => 70,  70 => 31,  67 => 29,  65 => 28,  47 => 12,  44 => 10,);
    }

    public function getSourceContext(): Source
    {
        return new Source("", "themes/custom/elraco/templates/navigation/menu--main.html.twig", "/home/ismigar/webapps/web/web/themes/custom/elraco/templates/navigation/menu--main.html.twig");
    }
    
    public function checkSecurity()
    {
        static $tags = ["import" => 28, "macro" => 33, "if" => 35, "for" => 42];
        static $filters = ["escape" => 46];
        static $functions = ["link" => 63];

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
