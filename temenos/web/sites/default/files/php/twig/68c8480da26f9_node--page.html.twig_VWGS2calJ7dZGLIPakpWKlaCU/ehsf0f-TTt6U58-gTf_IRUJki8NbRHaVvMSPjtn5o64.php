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

/* themes/custom/elraco/templates/content/node--page.html.twig */
class __TwigTemplate_3913cfe728c02d5ce5470318c2ee5a67 extends Template
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
        // line 1
        yield "<page ";
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, ($context["attributes"] ?? null), "html", null, true);
        yield ">

    ";
        // line 4
        yield "    ";
        if (CoreExtension::getAttribute($this->env, $this->source, ($context["content"] ?? null), "field_image", [], "any", false, false, true, 4)) {
            // line 5
            yield "        <div class=\"field--image\">
            ";
            // line 6
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["content"] ?? null), "field_image", [], "any", false, false, true, 6), "html", null, true);
            yield "
        </div>
    ";
        }
        // line 9
        yield "
    ";
        // line 11
        yield "    ";
        if (($context["display_submitted"] ?? null)) {
            // line 12
            yield "        <div class=\"submitted\">
            ";
            // line 13
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->renderVar(t("Escrit per"));
            yield " 
            <span class=\"field-nom-i-cognoms\">
                ";
            // line 15
            if ( !Twig\Extension\CoreExtension::testEmpty(CoreExtension::getAttribute($this->env, $this->source, CoreExtension::getAttribute($this->env, $this->source, CoreExtension::getAttribute($this->env, $this->source, CoreExtension::getAttribute($this->env, $this->source, ($context["node"] ?? null), "uid", [], "any", false, false, true, 15), "entity", [], "any", false, false, true, 15), "field_nom_i_cognoms", [], "any", false, false, true, 15), "value", [], "any", false, false, true, 15))) {
                // line 16
                yield "                    ";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, CoreExtension::getAttribute($this->env, $this->source, CoreExtension::getAttribute($this->env, $this->source, CoreExtension::getAttribute($this->env, $this->source, ($context["node"] ?? null), "uid", [], "any", false, false, true, 16), "entity", [], "any", false, false, true, 16), "field_nom_i_cognoms", [], "any", false, false, true, 16), "value", [], "any", false, false, true, 16), "html", null, true);
                yield "
                ";
            } else {
                // line 18
                yield "                    ";
                yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, CoreExtension::getAttribute($this->env, $this->source, CoreExtension::getAttribute($this->env, $this->source, ($context["node"] ?? null), "uid", [], "any", false, false, true, 18), "entity", [], "any", false, false, true, 18), "getDisplayName", [], "method", false, false, true, 18), "html", null, true);
                yield "
                ";
            }
            // line 20
            yield "            </span>
                ";
            // line 21
            yield "  -  ";
            yield " ";
            yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, $this->env->getFilter('format_date')->getCallable()(CoreExtension::getAttribute($this->env, $this->source, ($context["node"] ?? null), "getCreatedTime", [], "method", false, false, true, 21), "custom", "d M Y"), "html", null, true);
            yield "
        </div>
    ";
        }
        // line 24
        yield "

    ";
        // line 27
        yield "    <div class=\"content\">
        ";
        // line 28
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, CoreExtension::getAttribute($this->env, $this->source, ($context["content"] ?? null), "body", [], "any", false, false, true, 28), "html", null, true);
        yield "
    </div>


    <div class=\"content-extra\">
        ";
        // line 33
        yield $this->extensions['Drupal\Core\Template\TwigExtension']->escapeFilter($this->env, $this->extensions['Drupal\Core\Template\TwigExtension']->withoutFilter(($context["content"] ?? null), "field_image", "body"), "html", null, true);
        yield "
    </div>
</page>
";
        $this->env->getExtension('\Drupal\Core\Template\TwigExtension')
            ->checkDeprecations($context, ["attributes", "content", "display_submitted", "node"]);        yield from [];
    }

    /**
     * @codeCoverageIgnore
     */
    public function getTemplateName(): string
    {
        return "themes/custom/elraco/templates/content/node--page.html.twig";
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
        return array (  116 => 33,  108 => 28,  105 => 27,  101 => 24,  93 => 21,  90 => 20,  84 => 18,  78 => 16,  76 => 15,  71 => 13,  68 => 12,  65 => 11,  62 => 9,  56 => 6,  53 => 5,  50 => 4,  44 => 1,);
    }

    public function getSourceContext(): Source
    {
        return new Source("", "themes/custom/elraco/templates/content/node--page.html.twig", "/home/ismigar/webapps/web/web/themes/custom/elraco/templates/content/node--page.html.twig");
    }
    
    public function checkSecurity()
    {
        static $tags = ["if" => 4];
        static $filters = ["escape" => 1, "t" => 13, "format_date" => 21, "without" => 33];
        static $functions = [];

        try {
            $this->sandbox->checkSecurity(
                ['if'],
                ['escape', 't', 'format_date', 'without'],
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
