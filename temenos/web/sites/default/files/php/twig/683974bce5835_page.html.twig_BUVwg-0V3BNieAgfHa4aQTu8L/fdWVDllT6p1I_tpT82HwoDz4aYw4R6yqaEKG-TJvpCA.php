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

/* themes/custom/elraco/templates/page.html.twig */
class __TwigTemplate_64669a99592df622eb43135eb6120af3 extends Template
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
        // line 73
        yield "<div id=\"page-wrapper\">

  <header role=\"banner\" id=\"header\" class=\"clearfix\">
    <div class=\"container\">
        <link rel=\"stylesheet\" href=\"https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css\">
\t";
        // line 78
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "header", [], "any", false, false, true, 78), "html", null, true);
        yield "
\t
\t</div>
  </header>

  ";
        // line 84
        yield "  ";
        if (($context["slider"] ?? null)) {
            // line 85
            yield "    <div class=\"flexslider\">
      <ul class=\"slides\">
        ";
            // line 87
            $context['_parent'] = $context;
            $context['_seq'] = CoreExtension::ensureTraversable(($context["slider"] ?? null));
            foreach ($context['_seq'] as $context["_key"] => $context["slide"]) {
                // line 88
                yield "          <li>
            <a href=\"";
                // line 89
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["slide"], "url", [], "any", false, false, true, 89), "html", null, true);
                yield "\"><img src=\"";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["slide"], "src", [], "any", false, false, true, 89), "html", null, true);
                yield "\"></a>
            <p class=\"flex-caption\">";
                // line 90
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["slide"], "title", [], "any", false, false, true, 90), "html", null, true);
                yield "</p>
          </li>
        ";
            }
            $_parent = $context['_parent'];
            unset($context['_seq'], $context['_key'], $context['slide'], $context['_parent']);
            $context = array_intersect_key($context, $_parent) + $_parent;
            // line 93
            yield "      </ul>
    </div>
  ";
        }
        // line 96
        yield "
  ";
        // line 97
        if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "highlighted", [], "any", false, false, true, 97)) {
            // line 98
            yield "    <div id=\"highlighted\"><div class=\"container\">
\t<div class=\"row\">";
            // line 99
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "highlighted", [], "any", false, false, true, 99), "html", null, true);
            yield "</div>
\t</div></div>
  ";
        }
        // line 102
        yield "\t<div class=\"container\">";
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "breadcrumb", [], "any", false, false, true, 102), "html", null, true);
        yield "</div>
  ";
        // line 104
        yield "  ";
        if (((CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high1", [], "any", false, false, true, 104) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high2", [], "any", false, false, true, 104)) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high3", [], "any", false, false, true, 104))) {
            // line 105
            yield "    <div id=\"home-highlights\" class=\"row\">
      <div class=\"container\">";
            // line 106
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high1", [], "any", false, false, true, 106)) {
                // line 107
                yield "        <div class=\"home-high-1 col-md-4\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high1", [], "any", false, false, true, 107), "html", null, true);
                yield "</div>
      ";
            }
            // line 109
            yield "      ";
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high2", [], "any", false, false, true, 109)) {
                // line 110
                yield "        <div class=\"home-high-2 col-md-4\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high2", [], "any", false, false, true, 110), "html", null, true);
                yield "</div>
      ";
            }
            // line 112
            yield "      ";
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high3", [], "any", false, false, true, 112)) {
                // line 113
                yield "        <div class=\"home-high-3 col-md-4\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high3", [], "any", false, false, true, 113), "html", null, true);
                yield "</div>
      ";
            }
            // line 114
            yield "</div>
    </div>
  ";
        }
        // line 117
        yield "
  <main id=\"main\" class=\"clearfix\">
    <div class=\"container\">
\t<div class=\"row\">";
        // line 120
        if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "sidebar_first", [], "any", false, false, true, 120)) {
            // line 121
            yield "      <div id=\"sidebar-first\" class=\"sidebar ";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["sidebarfirst"] ?? null), "html", null, true);
            yield "\" role=\"complementary\">
\t          ";
            // line 122
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "sidebar_first", [], "any", false, false, true, 122), "html", null, true);
            yield "
\t\t\t  \t";
            // line 123
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "secondary_menu", [], "any", false, false, true, 123), "html", null, true);
            yield "

\t\t\t  </div>
       <!-- /#sidebar-first -->
    ";
        }
        // line 128
        yield "
    <div class=\"";
        // line 129
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["conditionalStr"] ?? null), "html", null, true);
        yield "\" role=\"main\">
      ";
        // line 130
        if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "content_top", [], "any", false, false, true, 130)) {
            // line 131
            yield "        <div id=\"content_top\">";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "content_top", [], "any", false, false, true, 131), "html", null, true);
            yield "</div>
      ";
        }
        // line 133
        yield "
      ";
        // line 134
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "content", [], "any", false, false, true, 134), "html", null, true);
        yield "

    </div>";
        // line 137
        yield "
    ";
        // line 138
        if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "sidebar_second", [], "any", false, false, true, 138)) {
            // line 139
            yield "      <div id=\"sidebar-second\" class=\"sidebar ";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["sidebarsecond"] ?? null), "html", null, true);
            yield "\" role=\"complementary\">
        ";
            // line 140
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "sidebar_second", [], "any", false, false, true, 140), "html", null, true);
            yield "
      </div> <!-- /#sidebar-first -->
    ";
        }
        // line 142
        yield "</div>
</div>
  </main>

  ";
        // line 147
        yield "  ";
        if ((((CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_first", [], "any", false, false, true, 147) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_second", [], "any", false, false, true, 147)) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_third", [], "any", false, false, true, 147)) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_fourth", [], "any", false, false, true, 147))) {
            // line 148
            yield "    <div id=\"footer-saran\" class=\"row\">
      <div id=\"footer-wrap\">
        ";
            // line 150
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_first", [], "any", false, false, true, 150)) {
                // line 151
                yield "          <div class=\"footer-1 col-md-3\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_first", [], "any", false, false, true, 151), "html", null, true);
                yield "</div>
        ";
            }
            // line 153
            yield "        ";
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_second", [], "any", false, false, true, 153)) {
                // line 154
                yield "          <div class=\"footer-2 col-md-3\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_second", [], "any", false, false, true, 154), "html", null, true);
                yield "</div>
        ";
            }
            // line 156
            yield "        ";
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_third", [], "any", false, false, true, 156)) {
                // line 157
                yield "          <div class=\"footer-3 col-md-3\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_third", [], "any", false, false, true, 157), "html", null, true);
                yield "</div>
        ";
            }
            // line 159
            yield "        ";
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_fourth", [], "any", false, false, true, 159)) {
                // line 160
                yield "          <div class=\"footer-4 col-md-3\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_fourth", [], "any", false, false, true, 160), "html", null, true);
                yield "</div>
        ";
            }
            // line 162
            yield "      </div>
    </div>
    <div class=\"clear\"></div>
  ";
        }
        // line 166
        yield "
  <footer class=\"site-footer\">
      <div class=\"container\">
        ";
        // line 169
        if ((((CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_first", [], "any", false, false, true, 169) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_second", [], "any", false, false, true, 169)) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_third", [], "any", false, false, true, 169)) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_fourth", [], "any", false, false, true, 169))) {
            // line 170
            yield "          <div class=\"site-footer__top clearfix\">
            ";
            // line 171
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_first", [], "any", false, false, true, 171), "html", null, true);
            yield "
            ";
            // line 172
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_second", [], "any", false, false, true, 172), "html", null, true);
            yield "
            ";
            // line 173
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_third", [], "any", false, false, true, 173), "html", null, true);
            yield "
            ";
            // line 174
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_fourth", [], "any", false, false, true, 174), "html", null, true);
            yield "
          </div>
        ";
        }
        // line 177
        yield "        ";
        if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_fifth", [], "any", false, false, true, 177)) {
            // line 178
            yield "          <div class=\"site-footer__bottom\">
            ";
            // line 179
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_fifth", [], "any", false, false, true, 179), "html", null, true);
            yield "
          </div>
        ";
        }
        // line 182
        yield "      </div>
    </footer>
</div>
";
        $this->env->getExtension('\Drupal\Core\Template\TwigExtension')
            ->checkDeprecations($context, ["page", "slider", "sidebarfirst", "conditionalStr", "sidebarsecond"]);        yield from [];
    }

    /**
     * @codeCoverageIgnore
     */
    public function getTemplateName(): string
    {
        return "themes/custom/elraco/templates/page.html.twig";
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
        return array (  306 => 182,  300 => 179,  297 => 178,  294 => 177,  288 => 174,  284 => 173,  280 => 172,  276 => 171,  273 => 170,  271 => 169,  266 => 166,  260 => 162,  254 => 160,  251 => 159,  245 => 157,  242 => 156,  236 => 154,  233 => 153,  227 => 151,  225 => 150,  221 => 148,  218 => 147,  212 => 142,  206 => 140,  201 => 139,  199 => 138,  196 => 137,  191 => 134,  188 => 133,  182 => 131,  180 => 130,  176 => 129,  173 => 128,  165 => 123,  161 => 122,  156 => 121,  154 => 120,  149 => 117,  144 => 114,  138 => 113,  135 => 112,  129 => 110,  126 => 109,  120 => 107,  118 => 106,  115 => 105,  112 => 104,  107 => 102,  101 => 99,  98 => 98,  96 => 97,  93 => 96,  88 => 93,  79 => 90,  73 => 89,  70 => 88,  66 => 87,  62 => 85,  59 => 84,  51 => 78,  44 => 73,);
    }

    public function getSourceContext(): Source
    {
        return new Source("", "themes/custom/elraco/templates/page.html.twig", "/home/ismigar/webapps/web/web/themes/custom/elraco/templates/page.html.twig");
    }
    
    public function checkSecurity()
    {
        static $tags = ["if" => 84, "for" => 87];
        static $filters = ["escape" => 78];
        static $functions = [];

        try {
            $this->sandbox->checkSecurity(
                ['if', 'for'],
                ['escape'],
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
