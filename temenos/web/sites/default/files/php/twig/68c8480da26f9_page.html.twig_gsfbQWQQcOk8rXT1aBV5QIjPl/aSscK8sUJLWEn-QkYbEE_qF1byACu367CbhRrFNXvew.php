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

/* themes/custom/elraco/templates/content/page.html.twig */
class __TwigTemplate_a9427df667024aee5ddddc90347c2536 extends Template
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
        <div class=\"breadcrum\">";
        // line 78
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "breadcrumb", [], "any", false, false, true, 78), "html", null, true);
        yield "</div>
        ";
        // line 79
        if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "header1", [], "any", false, false, true, 79)) {
            // line 80
            yield "          <div class=\"firs_header\">";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "header1", [], "any", false, false, true, 80), "html", null, true);
            yield "</div>
        ";
        }
        // line 82
        yield "        ";
        if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "header2", [], "any", false, false, true, 82)) {
            // line 83
            yield "          <div class=\"second_header\">";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "header2", [], "any", false, false, true, 83), "html", null, true);
            yield "</div>
        ";
        }
        // line 85
        yield "        ";
        if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "header3", [], "any", false, false, true, 85)) {
            // line 86
            yield "  \t  <div class=\"third_header\">";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "header3", [], "any", false, false, true, 86), "html", null, true);
            yield "</div>
        ";
        }
        // line 88
        yield "        ";
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "primary_menu", [], "any", false, false, true, 88), "html", null, true);
        yield "
    </div>
  </header>

  ";
        // line 93
        yield "  ";
        if (($context["slider"] ?? null)) {
            // line 94
            yield "    <div class=\"flexslider\">
      <ul class=\"slides\">
        ";
            // line 96
            $context['_parent'] = $context;
            $context['_seq'] = CoreExtension::ensureTraversable(($context["slider"] ?? null));
            foreach ($context['_seq'] as $context["_key"] => $context["slide"]) {
                // line 97
                yield "          <li class=\"slide\">
            <a href=\"";
                // line 98
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["slide"], "url", [], "any", false, false, true, 98), "html", null, true);
                yield "\">
              <img src=\"";
                // line 99
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, $context["slide"], "src", [], "any", false, false, true, 99), "html", null, true);
                yield "\" alt=\"\">
              <span class=\"flex-caption\">";
                // line 100
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar(CoreExtension::getAttribute($this->env, $this->source, $context["slide"], "caption", [], "any", false, false, true, 100));
                yield "</span>
            </a>
          </li>
        ";
            }
            $_parent = $context['_parent'];
            unset($context['_seq'], $context['_key'], $context['slide'], $context['_parent']);
            $context = array_intersect_key($context, $_parent) + $_parent;
            // line 104
            yield "      </ul>
    </div>
  ";
        }
        // line 107
        yield "
  ";
        // line 108
        if ((CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "highlighted", [], "any", false, false, true, 108) && ($context["is_front"] ?? null))) {
            // line 109
            yield "    <div id=\"highlighted\"><div class=\"container\">
\t<div class=\"row\">";
            // line 110
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "highlighted", [], "any", false, false, true, 110), "html", null, true);
            yield "</div>
\t</div></div>
  ";
        }
        // line 113
        yield "  ";
        // line 114
        yield "  ";
        if (((CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high1", [], "any", false, false, true, 114) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high2", [], "any", false, false, true, 114)) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high3", [], "any", false, false, true, 114))) {
            // line 115
            yield "    <div id=\"home-highlights\" class=\"row\">
      <div class=\"container\">";
            // line 116
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high1", [], "any", false, false, true, 116)) {
                // line 117
                yield "        <div class=\"home-high-1 col-md-4\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high1", [], "any", false, false, true, 117), "html", null, true);
                yield "</div>
      ";
            }
            // line 119
            yield "      ";
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high2", [], "any", false, false, true, 119)) {
                // line 120
                yield "        <div class=\"home-high-2 col-md-4\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high2", [], "any", false, false, true, 120), "html", null, true);
                yield "</div>
      ";
            }
            // line 122
            yield "      ";
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high3", [], "any", false, false, true, 122)) {
                // line 123
                yield "        <div class=\"home-high-3 col-md-4\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "home_high3", [], "any", false, false, true, 123), "html", null, true);
                yield "</div>
      ";
            }
            // line 124
            yield "</div>
    </div>
  ";
        }
        // line 127
        yield "
  <main id=\"main\" class=\"clearfix\">
    <div class=\"container\">
\t<div class=\"row\">";
        // line 130
        if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "sidebar_first", [], "any", false, false, true, 130)) {
            // line 131
            yield "      <div id=\"sidebar-first\" class=\"sidebar ";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["sidebarfirst"] ?? null), "html", null, true);
            yield "\" role=\"complementary\">
\t          ";
            // line 132
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "sidebar_first", [], "any", false, false, true, 132), "html", null, true);
            yield "
\t\t\t  \t";
            // line 133
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "secondary_menu", [], "any", false, false, true, 133), "html", null, true);
            yield "

\t\t\t  </div>
       <!-- /#sidebar-first -->
    ";
        }
        // line 138
        yield "
    <div class=\"";
        // line 139
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["conditionalStr"] ?? null), "html", null, true);
        yield "\" role=\"main\">
      ";
        // line 140
        if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "content_top", [], "any", false, false, true, 140)) {
            // line 141
            yield "        <div id=\"content_top\">";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "content_top", [], "any", false, false, true, 141), "html", null, true);
            yield "</div>
      ";
        }
        // line 143
        yield "
      ";
        // line 144
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "content", [], "any", false, false, true, 144), "html", null, true);
        yield "

    </div>";
        // line 147
        yield "
    ";
        // line 148
        if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "sidebar_second", [], "any", false, false, true, 148)) {
            // line 149
            yield "      <div id=\"sidebar-second\" class=\"sidebar ";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["sidebarsecond"] ?? null), "html", null, true);
            yield "\" role=\"complementary\">
        ";
            // line 150
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "sidebar_second", [], "any", false, false, true, 150), "html", null, true);
            yield "
      </div> <!-- /#sidebar-first -->
    ";
        }
        // line 152
        yield "</div>
</div>
  </main>

  ";
        // line 157
        yield "  ";
        if ((((CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_first", [], "any", false, false, true, 157) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_second", [], "any", false, false, true, 157)) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_third", [], "any", false, false, true, 157)) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_fourth", [], "any", false, false, true, 157))) {
            // line 158
            yield "    <div id=\"footer-saran\" class=\"row\">
      <div id=\"footer-wrap\">
        ";
            // line 160
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_first", [], "any", false, false, true, 160)) {
                // line 161
                yield "          <div class=\"footer-1 col-md-3\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_first", [], "any", false, false, true, 161), "html", null, true);
                yield "</div>
        ";
            }
            // line 163
            yield "        ";
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_second", [], "any", false, false, true, 163)) {
                // line 164
                yield "          <div class=\"footer-2 col-md-3\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_second", [], "any", false, false, true, 164), "html", null, true);
                yield "</div>
        ";
            }
            // line 166
            yield "        ";
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_third", [], "any", false, false, true, 166)) {
                // line 167
                yield "          <div class=\"footer-3 col-md-3\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_third", [], "any", false, false, true, 167), "html", null, true);
                yield "</div>
        ";
            }
            // line 169
            yield "        ";
            if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_fourth", [], "any", false, false, true, 169)) {
                // line 170
                yield "          <div class=\"footer-4 col-md-3\">";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_fourth", [], "any", false, false, true, 170), "html", null, true);
                yield "</div>
        ";
            }
            // line 172
            yield "      </div>
    </div>
    <div class=\"clear\"></div>
  ";
        }
        // line 176
        yield "
  <footer class=\"site-footer\">
      <div class=\"container\">
        ";
        // line 179
        if ((((CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_first", [], "any", false, false, true, 179) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_second", [], "any", false, false, true, 179)) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_third", [], "any", false, false, true, 179)) || CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_fourth", [], "any", false, false, true, 179))) {
            // line 180
            yield "          <div class=\"site-footer__top clearfix\">
            ";
            // line 181
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_first", [], "any", false, false, true, 181), "html", null, true);
            yield "
            ";
            // line 182
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_second", [], "any", false, false, true, 182), "html", null, true);
            yield "
            ";
            // line 183
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_third", [], "any", false, false, true, 183), "html", null, true);
            yield "
            ";
            // line 184
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_fourth", [], "any", false, false, true, 184), "html", null, true);
            yield "
          </div>
        ";
        }
        // line 187
        yield "        ";
        if (CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_fifth", [], "any", false, false, true, 187)) {
            // line 188
            yield "          <div class=\"site-footer__bottom\">
            ";
            // line 189
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["page"] ?? null), "footer_fifth", [], "any", false, false, true, 189), "html", null, true);
            yield "
          </div>
        ";
        }
        // line 192
        yield "      </div>
    </footer>
</div>
";
        $this->env->getExtension('\Drupal\Core\Template\TwigExtension')
            ->checkDeprecations($context, ["page", "slider", "is_front", "sidebarfirst", "conditionalStr", "sidebarsecond"]);        yield from [];
    }

    /**
     * @codeCoverageIgnore
     */
    public function getTemplateName(): string
    {
        return "themes/custom/elraco/templates/content/page.html.twig";
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
        return array (  336 => 192,  330 => 189,  327 => 188,  324 => 187,  318 => 184,  314 => 183,  310 => 182,  306 => 181,  303 => 180,  301 => 179,  296 => 176,  290 => 172,  284 => 170,  281 => 169,  275 => 167,  272 => 166,  266 => 164,  263 => 163,  257 => 161,  255 => 160,  251 => 158,  248 => 157,  242 => 152,  236 => 150,  231 => 149,  229 => 148,  226 => 147,  221 => 144,  218 => 143,  212 => 141,  210 => 140,  206 => 139,  203 => 138,  195 => 133,  191 => 132,  186 => 131,  184 => 130,  179 => 127,  174 => 124,  168 => 123,  165 => 122,  159 => 120,  156 => 119,  150 => 117,  148 => 116,  145 => 115,  142 => 114,  140 => 113,  134 => 110,  131 => 109,  129 => 108,  126 => 107,  121 => 104,  111 => 100,  107 => 99,  103 => 98,  100 => 97,  96 => 96,  92 => 94,  89 => 93,  81 => 88,  75 => 86,  72 => 85,  66 => 83,  63 => 82,  57 => 80,  55 => 79,  51 => 78,  44 => 73,);
    }

    public function getSourceContext(): Source
    {
        return new Source("", "themes/custom/elraco/templates/content/page.html.twig", "/home/ismigar/webapps/web/web/themes/custom/elraco/templates/content/page.html.twig");
    }
    
    public function checkSecurity()
    {
        static $tags = ["if" => 79, "for" => 96];
        static $filters = ["escape" => 78, "raw" => 100];
        static $functions = [];

        try {
            $this->sandbox->checkSecurity(
                ['if', 'for'],
                ['escape', 'raw'],
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
